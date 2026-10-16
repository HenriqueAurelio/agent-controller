import fs from 'node:fs';
import path from 'node:path';
import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { CheckService } from '@core/checks/CheckService';
import { failureReport } from '@core/checks/report';
import { suggestChecks } from '@core/checks/suggest';
import type { ChangesService } from '@core/git/ChangesService';
import { currentBranch } from '@core/git/GitService';
import { expandPrompt, promptVariables } from '@core/prompts/expand';
import {
  defaultWorktreesFolder,
  folderSize,
  localBranches,
  removeWorktree,
  worktreeOwner,
  worktreeStatus,
} from '@core/git/WorktreeService';
import type { SessionManager } from '@core/sessions/SessionManager';
import type { AppData } from '@core/store/appStore';
import type { CodeThemeStore } from '@core/store/codeThemeStore';
import {
  parsePreferencesFile,
  PREFS_FILE_MAX_BYTES,
  serializePreferences,
} from '@core/store/prefsFile';
import { folderKey, rememberFolder } from '@core/store/recentFolders';
import { sanitizeWorktreeSettings } from '@core/store/appStore';
import { AGENT_COMMAND_LIMIT, sanitizeAgentCommand, type AgentAvailability } from '@shared/agents';
import { CHECKS_LIMIT, sanitizeChecks, type ChecksInfo } from '@shared/checks';
import { CODE_THEME_MAX_BYTES } from '@shared/codeThemes';
import { errorText, translate, UserError, type MessageKey } from '@shared/i18n';
import type { DiffBase } from '@shared/git';
import type {
  CommandChannel,
  EventChannel,
  IpcCommands,
  IpcEvents,
  SessionsSnapshot,
  WorktreeCopy,
  WorktreesInfo,
} from '@shared/ipc';
import { sanitizePreferences, type Preferences } from '@shared/prefs';
import {
  PROMPT_TEXT_LIMIT,
  SELECTION_LIMIT,
  SEND_TARGETS_LIMIT,
  SEND_TEXT_LIMIT,
  type PromptValues,
  type SendOutcome,
} from '@shared/prompts';
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
  /** Where the copies of discarded files go. */
  discardDir: string;
  codeThemes: CodeThemeStore;
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
const promptValues = (value: unknown): PromptValues => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const answers: Record<string, string> = {};
  const given = v.answers && typeof v.answers === 'object' ? Object.entries(v.answers) : [];
  if (given.length > 50)
    throw new UserError('error.invalidArgument', { name: { key: 'arg.text' } });
  for (const [question, answer] of given) answers[question] = str(answer, 'text', 8000);
  if (typeof v.selection === 'string' && v.selection.length > SELECTION_LIMIT) {
    throw new UserError('error.prompt.selectionTooLarge', { limit: SELECTION_LIMIT });
  }
  return {
    file: v.file === undefined ? undefined : str(v.file, 'file'),
    selection: v.selection === undefined ? undefined : str(v.selection, 'text', SELECTION_LIMIT),
    answers,
  };
};
const base = (value: unknown): DiffBase =>
  value === 'session' || value === 'branchBase' ? value : 'head';
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
  /** A terminal of the channels: a session's agent, or the shell beside it while it is open. */
  const terminal = (id: unknown) => {
    const value = str(id, 'session', 64);
    if (!manager.hasTerminal(value)) throw new UserError('error.session.notFound');
    return value;
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

  handle('themes:list', () => context.codeThemes.list());
  handle('themes:get', (id) => context.codeThemes.get(str(id, 'theme', 100)));
  handle('themes:remove', (id) => context.codeThemes.remove(str(id, 'theme', 100)));
  handle('themes:import', async () => {
    const window = context.getWindow();
    let file = context.testMode
      ? (process.env.AGENT_CONTROLLER_TEST_THEME_FILE ?? null)
      : undefined;
    if (file === undefined) {
      if (!window) return null;
      const result = await dialog.showOpenDialog(window, {
        title: t('main.importTheme.title'),
        filters: [{ name: t('main.importTheme.filter'), extensions: ['json', 'jsonc'] }],
        properties: ['openFile'],
      });
      file = result.canceled ? null : (result.filePaths[0] ?? null);
    }
    if (!file) return null;
    const { size } = await fs.promises.stat(file);
    if (size > CODE_THEME_MAX_BYTES) throw new UserError('error.theme.tooLarge');
    return context.codeThemes.import(await fs.promises.readFile(file, 'utf8'));
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
  handle('sessions:create', async (input) => {
    const profile = input?.profile;
    if (!AGENT_PROFILE_IDS.includes(profile)) throw new UserError('error.unknownProfile');
    const wanted = input.worktree;
    const clean = {
      name: str(input.name, 'name', 200),
      cwd: str(input.cwd, 'folder'),
      profile,
      command: input.command === undefined ? undefined : command(input.command),
      groupId: input.groupId == null ? undefined : str(input.groupId, 'group', 64),
      ...(wanted !== undefined && {
        worktree: {
          branch: str(wanted?.branch, 'branch', 200),
          base: str(wanted?.base, 'branch', 200),
        },
      }),
    };
    if (!clean.worktree) {
      const created = manager.create(clean);
      remember(created.cwd);
      return created;
    }
    // The folder asked for is the repository; the session gets the copy.
    const created = await manager.createInWorktree(clean, {
      parent: worktreesFolder(),
      setup: context.data.worktrees.setup,
    });
    remember(clean.cwd);
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
  handle('sessions:remove', async (id, options) => {
    const s = session(id);
    const removeCopy = options?.worktree === 'remove';
    // The watcher of the panel holds the folder open; on Windows that keeps it from going.
    if (removeCopy) changes.close(s.id);
    await manager.remove(s.id, { worktree: removeCopy ? 'remove' : 'keep' });
  });
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

  handle('terminal:attach', (id, terminalSize) => manager.attach(terminal(id), size(terminalSize)));
  handle('terminal:detach', (id) => manager.detach(str(id, 'session', 64)));
  handle('terminal:setVisible', (id, visible) =>
    manager.setVisible(str(id, 'session', 64), visible === true),
  );
  handle('terminal:input', (id, data) =>
    manager.input(terminal(id), str(data, 'data', 16 * 1024 * 1024)),
  );
  handle('terminal:resize', (id, terminalSize) =>
    manager.resize(str(id, 'session', 64), size(terminalSize)),
  );
  handle('terminal:ack', (id, chars) => {
    if (typeof chars === 'number' && chars > 0) manager.ack(str(id, 'session', 64), chars);
  });
  handle('terminal:screenText', (id) => manager.screenText(terminal(id)));
  handle('aux:open', (id, terminalSize) => manager.openAux(session(id).id, size(terminalSize)));
  handle('aux:close', (id) => manager.closeAux(session(id).id));

  /** The prompt as it reaches one session: its name, folder and branch, and what the user gave. */
  const expandFor = async (sessionId: string, text: string, values: PromptValues) => {
    const s = session(sessionId);
    const branch = promptVariables(text).includes('branch')
      ? ((await currentBranch(s.cwd).catch(() => null)) ?? '')
      : '';
    const expanded = expandPrompt(
      text,
      { session: s.name, folder: s.cwd, branch, file: values.file, selection: values.selection },
      values.answers,
    );
    if (expanded.length > SEND_TEXT_LIMIT) {
      throw new UserError('error.prompt.tooLarge', { limit: SEND_TEXT_LIMIT });
    }
    return expanded;
  };
  handle('prompts:preview', (id, text, values) =>
    expandFor(str(id, 'session', 64), str(text, 'text', PROMPT_TEXT_LIMIT), promptValues(values)),
  );
  handle('terminal:sendText', async (ids, prompt, options) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > SEND_TARGETS_LIMIT) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.session' } });
    }
    const text = str(prompt?.text, 'text', PROMPT_TEXT_LIMIT);
    const values = promptValues(prompt?.values);
    const targets = [...new Set(ids.map((id) => session(id).id))];
    // Every text is ready before the first one goes: a failure sends nothing.
    const texts = await Promise.all(targets.map((id) => expandFor(id, text, values)));
    const outcomes: Record<string, SendOutcome> = {};
    targets.forEach((id, index) => {
      outcomes[id] = manager.sendText(id, texts[index]!, {
        submit: options?.submit === true,
        now: options?.now === true,
      });
    });
    return outcomes;
  });
  handle('terminal:cancelSend', (id) => manager.cancelPending(session(id).id));

  const worktreesFolder = () => context.data.worktrees.folder || defaultWorktreesFolder();
  const worktreesInfo = async (): Promise<WorktreesInfo> => {
    const parent = worktreesFolder();
    const sessions = manager.list();
    const found = new Map<string, string>();
    const add = (folder: string) => found.set(folderKey(folder), folder);
    for (const s of sessions) if (s.worktree) add(s.cwd);
    // What is in the folder of the copies: one folder per repository, one per copy in it.
    const children = async (dir: string) =>
      (await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []))
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(dir, entry.name));
    for (const repoDir of await children(parent))
      for (const copy of await children(repoDir)) add(copy);
    const copies = await Promise.all(
      [...found.values()].map(async (folder): Promise<WorktreeCopy | null> => {
        const repoRoot = await worktreeOwner(folder);
        if (!repoRoot) return null;
        const [branch, size, stat] = await Promise.all([
          currentBranch(folder).catch(() => null),
          folderSize(folder),
          fs.promises.stat(folder),
        ]);
        return {
          folder,
          repoRoot,
          branch,
          size: size.bytes,
          sizeComplete: size.complete,
          modifiedAt: stat.mtimeMs,
          sessions: sessions
            .filter((s) => folderKey(s.cwd) === folderKey(folder))
            .map((s) => s.name),
        };
      }),
    );
    return {
      folder: parent,
      defaultFolder: defaultWorktreesFolder(),
      configuredFolder: context.data.worktrees.folder,
      setup: context.data.worktrees.setup,
      copies: copies
        .filter((c): c is WorktreeCopy => c !== null)
        .sort((a, b) => b.modifiedAt - a.modifiedAt),
    };
  };
  handle('worktrees:inspect', async (folder) => {
    const target = str(folder, 'folder');
    if (!(await isFolder(target))) return { repo: false, current: null, branches: [] };
    const branches = await localBranches(target).catch(() => null);
    return branches
      ? { repo: true, current: branches.current, branches: branches.all }
      : { repo: false, current: null, branches: [] };
  });
  handle('worktrees:status', (id) => {
    const s = session(id);
    if (!s.worktree) throw new UserError('error.worktree.notWorktree', { folder: s.cwd });
    return worktreeStatus(s.cwd);
  });
  handle('worktrees:list', () => worktreesInfo());
  handle('worktrees:configure', (settings) => {
    const folder = str(settings?.folder, 'folder');
    const setup = command(str(settings?.setup, 'command'));
    if (folder.trim() && !path.isAbsolute(folder.trim())) {
      throw new UserError('error.worktree.folderNotAbsolute', { folder });
    }
    context.data.worktrees = sanitizeWorktreeSettings({ folder, setup });
    manager.flushPersist();
    return worktreesInfo();
  });
  handle('worktrees:remove', async (folder) => {
    const target = str(folder, 'folder');
    // Only a copy of the list: never any folder the renderer names.
    const copy = (await worktreesInfo()).copies.find(
      (c) => folderKey(c.folder) === folderKey(target),
    );
    if (!copy) throw new UserError('error.worktree.notWorktree', { folder: target });
    if (copy.sessions.length > 0)
      throw new UserError('error.worktree.inUse', { name: copy.sessions[0]! });
    await removeWorktree(copy.folder);
    return worktreesInfo();
  });

  /** The base a session in a copy compares with: the one its branch started from. */
  const branchBase = (sessionId: string) => manager.get(sessionId)?.worktree?.base;
  handle('git:open', (id, diffBase) => {
    const s = session(id);
    return changes.overview(s.id, s.cwd, base(diffBase), {
      watch: true,
      branchBase: branchBase(s.id),
    });
  });
  handle('git:refresh', (id, diffBase) => {
    const s = session(id);
    return changes.overview(s.id, s.cwd, base(diffBase), { branchBase: branchBase(s.id) });
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
  const files = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.file' } });
    }
    return value.map((file) => str(file, 'file'));
  };
  handle('git:stage', (id, list) => changes.stage(session(id).id, files(list)));
  handle('git:unstage', (id, list) => changes.unstage(session(id).id, files(list)));
  handle('git:commit', async (id, repo, message) => {
    const result = await changes.commit(
      session(id).id,
      str(repo, 'path'),
      str(message, 'message', 64 * 1024),
    );
    return { commit: result.commit };
  });
  handle('git:discard', async (id, file) => {
    const record = await changes.discard(session(id).id, str(file, 'file'), context.discardDir);
    return { id: record.id };
  });
  handle('git:undoDiscard', (id, discardId) =>
    changes.undoDiscard(session(id).id, str(discardId, 'text', 64), context.discardDir),
  );
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
