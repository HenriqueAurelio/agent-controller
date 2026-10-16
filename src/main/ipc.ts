import fs from 'node:fs';
import path from 'node:path';
import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { CheckService } from '@core/checks/CheckService';
import { failureReport } from '@core/checks/report';
import { suggestChecks } from '@core/checks/suggest';
import type { ChangesService } from '@core/git/ChangesService';
import type { SessionManager } from '@core/sessions/SessionManager';
import type { AppData } from '@core/store/appStore';
import {
  parsePreferencesFile,
  PREFS_FILE_MAX_BYTES,
  serializePreferences,
} from '@core/store/prefsFile';
import { folderKey, rememberFolder } from '@core/store/recentFolders';
import { AGENT_COMMAND_LIMIT, sanitizeAgentCommand, type AgentAvailability } from '@shared/agents';
import { CHECKS_LIMIT, sanitizeChecks, type ChecksInfo } from '@shared/checks';
import { errorText, translate, UserError, type MessageKey } from '@shared/i18n';
import type {
  CommandChannel,
  EventChannel,
  IpcCommands,
  IpcEvents,
  SessionsSnapshot,
} from '@shared/ipc';
import { sanitizePreferences, type Preferences } from '@shared/prefs';
import {
  AGENT_PROFILE_IDS,
  GROUP_NAME_LIMIT,
  type GroupUpdate,
  type TerminalSize,
} from '@shared/session';

export interface IpcContext {
  manager: SessionManager;
  changes: ChangesService;
  checks: CheckService;
  data: AppData;
  testMode: boolean;
  gpuMode: 'fast' | 'safe';
  send<K extends EventChannel>(channel: K, ...args: Parameters<IpcEvents[K]>): void;
  detectAgents(refresh: boolean): Promise<AgentAvailability[]>;
  getWindow(): BrowserWindow | null;
  savePrefs(prefs: Preferences): void;
  setUnsaved(file: string | null): void;
}

type Handler<K extends CommandChannel> = (
  ...args: Parameters<IpcCommands[K]>
) => ReturnType<IpcCommands[K]> | Promise<ReturnType<IpcCommands[K]>>;

type ArgumentName = Extract<MessageKey, `arg.${string}`> extends `arg.${infer Name}` ? Name : never;

// Arguments come from the renderer: checked here, never trusted.
const str = (value: unknown, name: ArgumentName, max = 4096): string => {
  if (typeof value !== 'string' || value.length > max) {
    throw new UserError('error.invalidArgument', { name: { key: `arg.${name}` } });
  }
  return value;
};
/** A command to run in place of the agent's own: one line, or it is refused. */
const command = (value: unknown): string => {
  const text = str(value, 'command', AGENT_COMMAND_LIMIT);
  if (text.trim() && !sanitizeAgentCommand(text)) {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.command' } });
  }
  return text;
};
const size = (value: unknown): TerminalSize => {
  const v = value as Partial<TerminalSize> | null;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!v || !ok(v.cols) || !ok(v.rows)) throw new UserError('error.terminalSize');
  return {
    cols: Math.min(1000, Math.max(2, Math.floor(v.cols))),
    rows: Math.min(500, Math.max(1, Math.floor(v.rows))),
  };
};
const base = (value: unknown) => (value === 'session' ? 'session' : 'head');
/** Ids of sessions or groups: whatever is not one is left out, and the manager skips unknown ones. */
const ids = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > 1000) throw new UserError('error.invalidOrder');
  return value.filter((id): id is string => typeof id === 'string' && id.length <= 64);
};
const groupUpdate = (value: unknown): GroupUpdate => {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object') {
    throw new UserError('error.invalidArgument', { name: { key: 'arg.group' } });
  }
  return {
    ...(v.name !== undefined && { name: str(v.name, 'name', GROUP_NAME_LIMIT * 4) }),
    ...(v.collapsed !== undefined && { collapsed: v.collapsed === true }),
    ...(v.sessionIds !== undefined && { sessionIds: ids(v.sessionIds) }),
  };
};

export function snapshotOf(manager: SessionManager): SessionsSnapshot {
  return { sessions: manager.list(), groups: manager.listGroups(), selectedId: manager.selected };
}

export function registerIpc(context: IpcContext): void {
  const { manager, changes, checks } = context;

  // Read at each use: the language may change at any moment.
  const language = () => context.data.prefs.language;
  const t = (key: MessageKey) => translate(language(), key);

  const handle = <K extends CommandChannel>(channel: K, handler: Handler<K>) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        // Only the app's own window may call in.
        const window = context.getWindow();
        if (!window || window.isDestroyed() || event.sender !== window.webContents) {
          throw new UserError('error.unauthorized');
        }
        return await handler(...(args as Parameters<IpcCommands[K]>));
      } catch (err) {
        // Only the message crosses to the renderer: this is where it gets its language.
        throw err instanceof UserError ? new Error(errorText(language(), err)) : err;
      }
    });
  };
  const session = (id: unknown) => {
    const found = manager.get(str(id, 'session', 64));
    if (!found) throw new UserError('error.session.notFound');
    return found;
  };
  const isFolder = (folder: string) =>
    fs.promises.stat(folder).then(
      (stat) => stat.isDirectory(),
      () => false,
    );
  // Saved along with the sessions, which every change of folder already persists.
  const remember = (folder: string) => {
    context.data.recentFolders = rememberFolder(context.data.recentFolders, folder);
  };

  handle('app:ping', (message) => `pong: ${str(message, 'message', 200)}`);
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform as 'win32' | 'linux' | 'darwin',
    testMode: context.testMode,
    gpuMode: context.gpuMode,
  }));

  handle('app:setUnsaved', (file) => context.setUnsaved(file === null ? null : str(file, 'file')));

  handle('prefs:get', () => context.data.prefs);
  handle('prefs:set', (patch) => {
    const prefs = sanitizePreferences({ ...context.data.prefs, ...(patch ?? {}) });
    context.savePrefs(prefs);
    return prefs;
  });

  // In test mode nobody can answer a native dialog: the file comes from the environment.
  const testFile = () =>
    context.testMode ? (process.env.AGENT_CONTROLLER_TEST_PREFS_FILE ?? null) : undefined;
  const filters = () => [{ name: t('main.settingsFilter'), extensions: ['json'] }];
  handle('prefs:export', async () => {
    const window = context.getWindow();
    let file = testFile();
    if (file === undefined) {
      if (!window) return null;
      const result = await dialog.showSaveDialog(window, {
        title: t('main.export.title'),
        defaultPath: path.join(app.getPath('documents'), t('main.export.fileName')),
        filters: filters(),
      });
      file = result.canceled ? null : (result.filePath ?? null);
    }
    if (!file) return null;
    await fs.promises.writeFile(file, serializePreferences(context.data.prefs), 'utf8');
    return file;
  });
  handle('prefs:import', async () => {
    const window = context.getWindow();
    let file = testFile();
    if (file === undefined) {
      if (!window) return null;
      const result = await dialog.showOpenDialog(window, {
        title: t('main.import.title'),
        filters: filters(),
        properties: ['openFile'],
      });
      file = result.canceled ? null : (result.filePaths[0] ?? null);
    }
    if (!file) return null;
    const { size } = await fs.promises.stat(file);
    if (size > PREFS_FILE_MAX_BYTES) throw new UserError('error.prefs.tooLarge');
    const prefs = parsePreferencesFile(await fs.promises.readFile(file, 'utf8'));
    context.savePrefs(prefs);
    return prefs;
  });

  handle('agents:detect', (refresh) => context.detectAgents(refresh === true));

  handle('dialog:pickFolder', async (defaultPath) => {
    const window = context.getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: t('main.pickFolder'),
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle('folders:recent', async () => {
    const recent = context.data.recentFolders;
    const exists = await Promise.all(recent.map(isFolder));
    return recent.filter((_, index) => exists[index]);
  });
  handle('folders:resolve', async (dropped) => {
    const target = path.resolve(str(dropped, 'path'));
    if (await isFolder(target)) return target;
    const parent = path.dirname(target);
    return fs.existsSync(target) && (await isFolder(parent)) ? parent : null;
  });

  handle('clipboard:read', () => clipboard.readText());
  handle('clipboard:write', (text) => clipboard.writeText(str(text, 'text', 10 * 1024 * 1024)));
  handle('shell:openExternal', async (url) => {
    // Links in the terminal come from whatever the agent printed.
    if (!/^https?:\/\//i.test(str(url, 'url'))) throw new UserError('error.onlyHttp');
    await shell.openExternal(url);
  });

  handle('sessions:list', () => snapshotOf(manager));
  handle('sessions:create', (input) => {
    const profile = input?.profile;
    if (!AGENT_PROFILE_IDS.includes(profile)) throw new UserError('error.unknownProfile');
    const created = manager.create({
      name: str(input.name, 'name', 200),
      cwd: str(input.cwd, 'folder'),
      profile,
      command: input.command === undefined ? undefined : command(input.command),
      groupId: input.groupId == null ? undefined : str(input.groupId, 'group', 64),
    });
    remember(created.cwd);
    return created;
  });
  handle('sessions:setCwd', async (id, cwd) => {
    const { id: sessionId } = session(id);
    const ended = await manager.setCwd(sessionId, str(cwd, 'folder'));
    const moved = manager.get(sessionId);
    if (moved) remember(moved.cwd);
    return ended;
  });
  handle('sessions:duplicate', (id) => {
    const copy = manager.duplicate(session(id).id);
    remember(copy.cwd);
    return copy;
  });
  handle('sessions:rename', (id, name) => manager.rename(session(id).id, str(name, 'name', 200)));
  handle('sessions:remove', (id) => manager.remove(session(id).id));
  handle('sessions:reorder', (list) => manager.reorder(ids(list)));
  handle('sessions:setGroup', (list, groupId) =>
    manager.setGroup(ids(list), groupId === null ? null : str(groupId, 'group', 64)),
  );

  handle('groups:create', (name, sessionIds) =>
    manager.createGroup(str(name, 'name', GROUP_NAME_LIMIT * 4), ids(sessionIds ?? [])),
  );
  handle('groups:update', (id, update) =>
    manager.updateGroup(str(id, 'group', 64), groupUpdate(update)),
  );
  handle('groups:remove', (id) => manager.removeGroup(str(id, 'group', 64)));
  handle('groups:reorder', (list) => manager.reorderGroups(ids(list)));
  handle('sessions:select', (id) => manager.select(id === null ? null : session(id).id));
  handle('sessions:start', (id, terminalSize) => manager.start(session(id).id, size(terminalSize)));
  handle('sessions:stop', (id) => manager.stop(session(id).id));

  handle('terminal:attach', (id, terminalSize) =>
    manager.attach(session(id).id, size(terminalSize)),
  );
  handle('terminal:detach', (id) => manager.detach(str(id, 'session', 64)));
  handle('terminal:setVisible', (id, visible) =>
    manager.setVisible(str(id, 'session', 64), visible === true),
  );
  handle('terminal:input', (id, data) =>
    manager.input(str(id, 'session', 64), str(data, 'data', 16 * 1024 * 1024)),
  );
  handle('terminal:resize', (id, terminalSize) =>
    manager.resize(str(id, 'session', 64), size(terminalSize)),
  );
  handle('terminal:ack', (id, chars) => {
    if (typeof chars === 'number' && chars > 0) manager.ack(str(id, 'session', 64), chars);
  });
  handle('terminal:screenText', (id) => manager.screenText(str(id, 'session', 64)));

  handle('git:open', (id, diffBase) => {
    const s = session(id);
    return changes.overview(s.id, s.cwd, base(diffBase), { watch: true });
  });
  handle('git:refresh', (id, diffBase) => {
    const s = session(id);
    return changes.overview(s.id, s.cwd, base(diffBase));
  });
  handle('git:close', (id) => changes.close(str(id, 'session', 64)));
  handle('git:diff', (id, file, diffBase) =>
    changes.diff(session(id).id, str(file, 'file'), base(diffBase)),
  );
  handle('git:save', async (id, file, content, expected) => {
    const result = await changes.save(
      session(id).id,
      str(file, 'file'),
      str(content, 'content', 4 * 1024 * 1024),
      expected === null ? null : str(expected, 'expected', 4 * 1024 * 1024),
    );
    return { saved: result.saved };
  });
  handle('git:count', (id) => {
    const s = session(id);
    return changes.count(s.id, s.cwd);
  });
  handle('files:list', (id, dir, showHidden) => {
    const s = session(id);
    return changes.list(s.id, s.cwd, str(dir, 'folder'), showHidden === true);
  });

  const checksInfo = (sessionId: string): ChecksInfo => {
    const s = session(sessionId);
    const configured = context.data.checks[folderKey(s.cwd)] ?? [];
    const commands = new Set(configured.map((check) => check.command));
    return {
      folder: s.cwd,
      checks: configured,
      suggestions: suggestChecks(s.cwd).filter((check) => !commands.has(check.command)),
      run: checks.get(s.id),
    };
  };
  handle('checks:get', (id) => checksInfo(str(id, 'session', 64)));
  handle('checks:configure', (id, list) => {
    const s = session(id);
    // Commands the app will run: each one goes through the same check as an agent's command.
    if (!Array.isArray(list) || list.length > CHECKS_LIMIT) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.checks' } });
    }
    const clean = sanitizeChecks(list);
    if (clean.length !== list.length) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.checks' } });
    }
    const key = folderKey(s.cwd);
    if (clean.length) context.data.checks[key] = clean;
    else delete context.data.checks[key];
    manager.flushPersist();
    return checksInfo(s.id);
  });
  handle('checks:run', (id) => checks.runNow(session(id).id));
  handle('checks:cancel', (id) => checks.cancel(session(id).id));
  handle('checks:sendFailure', (id) => {
    const s = session(id);
    const run = checks.get(s.id);
    const report = run && failureReport(run, language());
    if (!report) throw new UserError('error.checks.nothingFailed');
    manager.paste(s.id, report);
  });
}
