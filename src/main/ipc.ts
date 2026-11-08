import fs from 'node:fs';
import path from 'node:path';
import { app, clipboard, dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import type { CheckService } from '@core/checks/CheckService';
import type { ChangesService } from '@core/git/ChangesService';
import type { CheckpointService } from '@core/git/CheckpointService';
import type { ExperimentService } from '@core/experiments/ExperimentService';
import type { TaskBoard } from '@core/tasks/TaskBoard';
import type { FlowEngine } from '@core/handoff/FlowEngine';
import type { ReviewerService } from '@core/handoff/ReviewerService';
import type { OverlapService } from '@core/git/OverlapService';
import type { PromptQueue } from '@core/prompts/PromptQueue';
import type { TailFeed } from '@core/sessions/TailFeed';
import { currentBranch } from '@core/git/GitService';
import type { PullWatcher } from '@core/forges/PullWatcher';
import type { PullGuard } from '@core/forges/PullGuard';
import type { BackgroundService } from '@core/background/BackgroundService';
import type { ReviewStore } from '@core/review/ReviewStore';
import type { SonarService } from '@core/sonar/SonarService';
import type { SonarConfigStore } from '@core/sonar/SonarConfigStore';
import type { SonarTokens } from './sonarTokens';
import { type Preview } from './preview';
import { expandPrompt, promptVariables } from '@core/prompts/expand';
import type { SessionManager } from '@core/sessions/SessionManager';
import type { AppData } from '@core/store/appStore';
import type { CodeThemeStore } from '@core/store/codeThemeStore';
import {
  parsePreferencesFile,
  PREFS_FILE_MAX_BYTES,
  serializePreferences,
} from '@core/store/prefsFile';
import { rememberFolder } from '@core/store/recentFolders';
import { parseCopyPatterns } from '@core/git/copyIntoWorktree';
import { type AgentAvailability } from '@shared/agents';
import { CODE_THEME_MAX_BYTES } from '@shared/codeThemes';
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
  PROMPT_TEXT_LIMIT,
  QUEUE_LIMIT,
  SEND_TARGETS_LIMIT,
  SEND_TEXT_LIMIT,
  type PromptValues,
  type SendOutcome,
} from '@shared/prompts';
import {
  AGENT_PROFILE_IDS,
  GROUP_NAME_LIMIT,
  PERMISSION_CHOICES,
  type PermissionChoice,
} from '@shared/session';
import { registerGitIpc } from './ipc/git';
import { registerPullsIpc } from './ipc/pulls';
import { registerReviewIpc } from './ipc/review';
import { registerTasksIpc } from './ipc/tasks';
import { registerToolsIpc } from './ipc/tools';
import { registerWorktreesIpc, worktreesFolder } from './ipc/worktrees';
import type { Handler, IpcKit } from './ipc/kit';
import {
  str,
  terminalData,
  command,
  size,
  promptValues,
  ids,
  groupUpdate,
  condition,
  queueUpdate,
} from './ipc/args';

export interface IpcContext {
  manager: SessionManager;
  changes: ChangesService;
  checks: CheckService;
  checkpoints: CheckpointService;
  overlaps: OverlapService;
  queue: PromptQueue;
  experiments: ExperimentService;
  tasks: TaskBoard;
  reviewer: ReviewerService;
  flows: FlowEngine;
  tails: TailFeed;
  pulls: PullWatcher;
  guard: PullGuard;
  background: BackgroundService;
  review: ReviewStore;
  preview: Preview;
  /** Where the marked-up screenshots for the agents are kept. */
  shotsDir: string;
  phone: {
    /** The vault of the token of the Telegram bot, under the key `telegram`. */
    tokens: SonarTokens;
    /** Sends a notice now, whatever the focus of the window; resolves with the error, or null. */
    send(title: string, body: string): Promise<string | null>;
  };
  sonar: {
    service: SonarService;
    configs: SonarConfigStore;
    tokens: SonarTokens;
    /** Starts the analysis of a session with the setup of its group. */
    start(sessionId: string): Promise<void>;
  };
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

/**
 * A prompt as it reaches one session: its name, folder and branch, and what the user gave. Filled
 * in at the moment it goes, so a prompt that waited in a queue names the branch of then.
 */
export async function expandForSession(
  manager: SessionManager,
  sessionId: string,
  text: string,
  values: PromptValues,
): Promise<string> {
  const s = manager.get(sessionId);
  if (!s) throw new UserError('error.session.notFound');
  const branch = promptVariables(text).includes('branch')
    ? ((await currentBranch(s.cwd).catch(() => null)) ?? '')
    : '';
  const expanded = expandPrompt(
    text,
    {
      session: s.name,
      folder: s.cwd,
      branch,
      file: values.file,
      selection: values.selection,
      problems: values.problems,
      pr: values.pr,
      pipeline: values.pipeline,
      review: values.review,
    },
    values.answers,
  );
  if (expanded.length > SEND_TEXT_LIMIT) {
    throw new UserError('error.prompt.tooLarge', { limit: SEND_TEXT_LIMIT });
  }
  return expanded;
}

export function snapshotOf(manager: SessionManager): SessionsSnapshot {
  return { sessions: manager.list(), groups: manager.listGroups(), selectedId: manager.selected };
}

export function registerIpc(context: IpcContext): void {
  const {
    manager,
    changes,
    checks,
    checkpoints,
    overlaps,
    queue,
    experiments,
    tasks,
    reviewer,
    flows,
  } = context;

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
    const imported = parsePreferencesFile(await fs.promises.readFile(file, 'utf8'));
    context.savePrefs(imported);
    return imported;
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
      parent: worktreesFolder(context.data),
      setup: context.data.worktrees.setup,
      copy: parseCopyPatterns(context.data.worktrees.copy),
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
    // While the session still says which repository they are in.
    if (options?.checkpoints === 'remove') await checkpoints.removeAll(s.id).catch(() => 0);
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
  handle('groups:remove', (id) => {
    const groupId = str(id, 'group', 64);
    manager.removeGroup(groupId);
    // The setup and the token of Sonar go with the group.
    context.sonar.configs.set(groupId, null);
    if (context.sonar.tokens.has(groupId)) context.sonar.tokens.set(groupId, null);
  });
  handle('groups:reorder', (list) => manager.reorderGroups(ids(list)));
  handle('sessions:newConversation', (id) => manager.newConversation(session(id).id));
  handle('sessions:select', (id) => manager.select(id === null ? null : session(id).id));
  handle('sessions:start', (id, terminalSize) => manager.start(session(id).id, size(terminalSize)));
  handle('sessions:stop', (id) => manager.stop(session(id).id));
  handle('sessions:answerPermission', (id, askId, choice) => {
    if (!PERMISSION_CHOICES.includes(choice as PermissionChoice)) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.choice' } });
    }
    return manager.answerPermission(session(id).id, str(askId, 'request', 64), choice);
  });
  handle('terminal:attach', (id, terminalSize) => manager.attach(terminal(id), size(terminalSize)));
  handle('terminal:detach', (id) => manager.detach(str(id, 'session', 64)));
  handle('terminal:setVisible', (id, visible) =>
    manager.setVisible(str(id, 'session', 64), visible === true),
  );
  handle('terminal:input', (id, data) => manager.input(terminal(id), terminalData(data)));
  handle('terminal:resize', (id, terminalSize) =>
    manager.resize(str(id, 'session', 64), size(terminalSize)),
  );
  handle('terminal:ack', (id, chars) => {
    if (typeof chars === 'number' && chars > 0) manager.ack(str(id, 'session', 64), chars);
  });
  handle('terminal:screenText', (id) => manager.screenText(terminal(id)));
  handle('aux:open', (id, terminalSize) => manager.openAux(session(id).id, size(terminalSize)));
  handle('aux:close', (id) => manager.closeAux(session(id).id));
  const expandFor = (sessionId: string, text: string, values: PromptValues) =>
    expandForSession(manager, session(sessionId).id, text, values);
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
  handle('queue:get', (id) => queue.get(session(id).id));
  handle('queue:add', async (ids, prompt) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > SEND_TARGETS_LIMIT) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.session' } });
    }
    const text = str(prompt?.text, 'text', PROMPT_TEXT_LIMIT);
    if (!text.trim()) throw new UserError('error.queue.empty');
    const values = promptValues(prompt?.values);
    const when = condition(prompt?.condition);
    const targets = [...new Set(ids.map((id) => session(id).id))];
    // All or nothing: a queue that is full, or a text that would not fit, puts nothing anywhere.
    const full = targets.find((id) => !queue.fits(id));
    if (full) {
      throw new UserError('error.queue.fullFor', {
        name: manager.get(full)!.name,
        limit: QUEUE_LIMIT,
      });
    }
    await Promise.all(targets.map((id) => expandFor(id, text, values)));
    for (const id of targets) queue.add(id, { text, values, condition: when });
  });
  const item = (value: unknown) => str(value, 'item', 64);
  handle('queue:update', (id, itemId, update) =>
    queue.update(session(id).id, item(itemId), queueUpdate(update)),
  );
  handle('queue:remove', (id, itemId) => queue.remove(session(id).id, item(itemId)));
  handle('queue:reorder', (id, list) => {
    if (!Array.isArray(list) || list.length > QUEUE_LIMIT) {
      throw new UserError('error.invalidOrder');
    }
    queue.reorder(session(id).id, list.map(item));
  });
  handle('queue:pause', (id) => queue.pause(session(id).id));
  handle('queue:resume', (id, options) =>
    queue.resume(session(id).id, { afterTurn: options?.afterTurn === true }),
  );
  handle('queue:sendNext', (id) => {
    const s = session(id);
    if (!manager.isRunning(s.id)) throw new UserError('error.session.notRunning');
    return queue.sendNext(s.id);
  });

  const kit: IpcKit = {
    context,
    manager,
    changes,
    checks,
    checkpoints,
    overlaps,
    queue,
    experiments,
    tasks,
    reviewer,
    flows,
    handle,
    session,
    terminal,
    t,
    language,
    isFolder,
    remember,
  };
  registerPullsIpc(kit);
  registerGitIpc(kit);
  registerWorktreesIpc(kit);
  registerTasksIpc(kit);
  registerReviewIpc(kit);
  registerToolsIpc(kit);
}
