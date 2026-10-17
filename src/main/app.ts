import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import {
  buildLaunchCommand,
  detectAgent,
  findOnPath,
  getProfile,
  interactiveShell,
  PROFILES,
  wrapInShell,
} from '@core/agents';
import type { LaunchCommand } from '@core/agents';
import { CheckService } from '@core/checks/CheckService';
import { ChangesService } from '@core/git/ChangesService';
import { CheckpointService } from '@core/git/CheckpointService';
import { repositoryRoot } from '@core/git/GitService';
import { cleanDiscarded } from '@core/git/GitWriteService';
import { MetricsSampler } from '@core/metrics/MetricsSampler';
import { PromptQueue } from '@core/prompts/PromptQueue';
import { PtyManager } from '@core/pty/PtyManager';
import { NotificationPolicy, type NotificationRequest } from '@core/sessions/NotificationPolicy';
import { SessionManager } from '@core/sessions/SessionManager';
import { turnEdge } from '@core/sessions/turns';
import { installAgentctl } from '@core/signals/agentctlInstall';
import { createSocketPath, HookServer } from '@core/signals/HookServer';
import { createAppStore, type AppData } from '@core/store/appStore';
import { CodeThemeStore } from '@core/store/codeThemeStore';
import { folderKey } from '@core/store/recentFolders';
import {
  chooseGpuMode,
  confirmHealthy,
  reportGpuFailure,
  type GpuMode,
} from '@core/store/gpuGuard';
import type { AgentAvailability } from '@shared/agents';
import { summarizeRun } from '@shared/checks';
import { errorText, translate, UserError, type MessageKey, type MessageParams } from '@shared/i18n';
import type { Session, SessionGroup } from '@shared/session';
import { expandForSession, registerIpc, snapshotOf, type IpcContext } from './ipc';
import { showNotification } from './notifications';
import { createMainWindow, saveWindowState } from './window';

const TEST_SHELL = process.env.AGENT_CONTROLLER_TEST_SHELL === '1';

function resourcesPath(...parts: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(app.getAppPath(), 'resources', ...parts);
}

/**
 * In test mode every session runs a plain shell: no account, no credits, same plumbing. A command
 * asked for runs as it would outside the tests, in the shell of the user.
 */
function testShell(session: Session, socketPath: string, command: string): LaunchCommand {
  const env = { AGENTCTL_SESSION_ID: session.id, AGENTCTL_SOCKET: socketPath };
  if (command) return wrapInShell({ file: '', args: [], env }, command);
  if (process.platform === 'win32') {
    return { file: process.env.ComSpec || 'cmd.exe', args: [], env };
  }
  return { file: 'bash', args: ['--noprofile', '--norc'], env: { ...env, PS1: '$ ' } };
}

/** In test mode the shell beside the agent is the same plain one, for the same reasons. */
function testAuxShell(): LaunchCommand {
  if (process.platform === 'win32')
    return { file: process.env.ComSpec || 'cmd.exe', args: [], env: {} };
  return { file: 'bash', args: ['--noprofile', '--norc'], env: { PS1: '$ ' } };
}

export async function startApp(): Promise<void> {
  // Tests and measurements run against a throwaway profile.
  const userDataOverride = process.env.AGENT_CONTROLLER_USER_DATA;
  if (userDataOverride) app.setPath('userData', userDataOverride);

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.setAppUserModelId('dev.agentcontroller.app');
  // The GPU work runs inside the main process instead of a process of its own: about 40 MB
  // less, which is what keeps the app under its memory ceiling (ADR 0009). The price is that a
  // crash of the video driver takes the whole app down, so a start that did not end well is
  // followed by safe ones: GPU in its own process, no hardware acceleration.
  const gpuMode: GpuMode =
    process.env.AGENT_CONTROLLER_GPU === 'safe'
      ? 'safe'
      : chooseGpuMode(app.getPath('userData'), app.getVersion());
  if (gpuMode === 'fast') app.commandLine.appendSwitch('in-process-gpu');
  else app.disableHardwareAcceleration();

  await app.whenReady();

  const userData = app.getPath('userData');
  const store = createAppStore(userData);
  const data: AppData = store.load();

  const agentctl = installAgentctl({
    sourceScript: resourcesPath('agentctl', 'agentctl.cjs'),
    directory: process.env.AGENT_CONTROLLER_AGENTCTL_DIR || undefined,
    runtime: process.execPath,
    windowsNotify: app.isPackaged
      ? [process.execPath, '--agentctl']
      : [process.execPath, app.getAppPath(), '--agentctl'],
  });

  const ptys = new PtyManager();
  const hookServer = new HookServer({
    socketPath: createSocketPath(),
    isKnownSession: (id) => manager.has(id),
  });

  const resolveLaunch = (session: Session): LaunchCommand => {
    // The command of the session, or the one the preferences give its agent.
    const command = session.command || data.prefs.agentCommands[session.profile];
    if (TEST_SHELL) return testShell(session, hookServer.socketPath, command);
    const profile = getProfile(session.profile);
    const context = { agentctl, dataDirectory: userData, socketPath: hookServer.socketPath };
    // The shell of the user is who finds a command of theirs: the agent need not be on the PATH.
    if (command) return wrapInShell(buildLaunchCommand(profile, session, context), command);
    const executablePath = findOnPath(profile.executable);
    if (!executablePath) {
      throw new UserError('agent.missing', {
        name: profile.displayName,
        command: profile.installCommand,
      });
    }
    return buildLaunchCommand(profile, session, { ...context, executablePath });
  };

  const persist = (
    sessions: Session[],
    selectedSessionId: string | null,
    groups: SessionGroup[],
  ) => {
    data.sessions = sessions;
    data.groups = groups;
    data.selectedSessionId = selectedSessionId;
    try {
      store.save(data);
    } catch (err) {
      console.error('Falha ao salvar as sessões:', err);
    }
  };

  const manager = new SessionManager({
    ptys,
    sessions: data.sessions,
    groups: data.groups,
    selectedId: data.selectedSessionId,
    prefs: data.prefs,
    resolveLaunch,
    resolveAuxShell: () => (TEST_SHELL ? testAuxShell() : interactiveShell()),
    persist,
  });
  hookServer.on('message', (message) => manager.handleHook(message));
  await hookServer.listen();

  let window: BrowserWindow | null = null;
  const send: IpcContext['send'] = (channel, ...args) => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  };

  const changes = new ChangesService({
    workDirectory: path.join(userData, 'snapshots'),
    onChange: (sessionId) => send('git:changed', sessionId),
  });
  // Snapshots of a previous run are useless: sessions always come back stopped.
  fs.rmSync(path.join(userData, 'snapshots'), { recursive: true, force: true });
  // Copies of what the panel discarded, kept a month for "undo". The tests keep theirs apart.
  const discardDir = TEST_SHELL
    ? path.join(userData, 'descartados')
    : path.join(os.homedir(), '.agent-controller', 'descartados');
  void cleanDiscarded(discardDir);

  const metrics = new MetricsSampler({
    roots: () => {
      const roots = new Map<string, number>();
      for (const session of manager.runningSessions()) {
        const pid = manager.pidOf(session.id);
        if (pid) roots.set(session.id, pid);
      }
      return roots;
    },
    onSample: (sample) => send('metrics:update', sample),
  });

  const notifications = new NotificationPolicy();
  const openSession = (sessionId: string) => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    manager.select(sessionId);
    send('app:focusSession', sessionId);
  };
  const notify = (request: NotificationRequest) =>
    showNotification(
      request,
      () => openSession(request.sessionId),
      (choice) => {
        if (!request.askId) return;
        // The button is the user's own answer; it only goes if the request is still the same.
        void manager
          .answerPermission(request.sessionId, request.askId, choice)
          .catch(() => 'stale' as const)
          .then((outcome) => {
            if (outcome === 'answered') return;
            showNotification(
              {
                sessionId: request.sessionId,
                kind: 'waiting',
                title: request.title,
                body: t('permission.stale'),
                silent: true,
              },
              () => openSession(request.sessionId),
            );
          });
      },
    );

  // A photo of the folder at the end of each turn that changed files (ADR 0021). The index files
  // it goes through are the app's; what it keeps is in the repository, under refs of its own.
  const checkpoints = new CheckpointService({
    directory: path.join(userData, 'checkpoints'),
    rootOf: async (sessionId) => {
      const session = manager.get(sessionId);
      return session ? repositoryRoot(session.cwd) : null;
    },
    settings: () => data.prefs.checkpoints,
    knownSessions: () => new Set(manager.list().map((session) => session.id)),
    onError: (sessionId, err) => console.error(`Checkpoint de ${sessionId} falhou:`, err),
  });
  checkpoints.on('changed', (sessionId) => send('checkpoints:changed', sessionId));

  const checks = new CheckService({
    targetOf: (sessionId) => {
      const session = manager.get(sessionId);
      if (!session) return null;
      return { cwd: session.cwd, checks: data.checks[folderKey(session.cwd)] ?? [] };
    },
    before: (sessionId) => checkpoints.idle(sessionId),
  });
  checks.on('changed', (sessionId, run) => {
    manager.setChecks(sessionId, run ? summarizeRun(run) : undefined);
    send('checks:changed', sessionId);
    const session = run && manager.list().find((s) => s.id === sessionId);
    const request =
      session &&
      notifications.evaluateChecks(session, run, {
        focused: manager.isFocused(sessionId),
        prefs: data.prefs,
      });
    if (request) notify(request);
  });

  const queue = new PromptQueue({
    directory: path.join(userData, 'queues'),
    sessionIds: data.sessions.map((session) => session.id),
    stateOf: (sessionId) =>
      manager.has(sessionId)
        ? { status: manager.statusOf(sessionId), running: manager.isRunning(sessionId) }
        : null,
    // The same way as "Send" of the prompt dialog, with Enter: a queue that waits for the user's
    // Enter does not move by itself (ADR 0015).
    deliver: async (sessionId, item) => {
      try {
        const text = await expandForSession(manager, sessionId, item.text, item.values);
        manager.sendText(sessionId, text, { submit: true });
      } catch (err) {
        throw new Error(errorText(data.prefs.language, err), { cause: err });
      }
    },
    runChecks: (sessionId) => {
      const session = manager.get(sessionId);
      if (!session || !(data.checks[folderKey(session.cwd)] ?? []).length) return false;
      checks.runNow(sessionId);
      return true;
    },
  });
  for (const sessionId of queue.sessions()) manager.setQueue(sessionId, queue.summary(sessionId));
  queue.on('changed', (sessionId, state) => {
    manager.setQueue(sessionId, queue.summary(sessionId));
    send('queue:changed', sessionId, state);
  });
  checks.on('changed', (sessionId, run) => queue.onChecks(sessionId, run));
  checks.on('changed', (sessionId, run) => {
    // The ✓/✗ of the timeline: the checks of the turn, on the checkpoint of the turn.
    if (run?.trigger !== 'turnEnd' || run.state !== 'done') return;
    const { state } = summarizeRun(run);
    if (state === 'passed' || state === 'failed') void checkpoints.recordChecks(sessionId, state);
  });

  manager.on('permission', (session) => {
    const request = notifications.evaluatePermission(session, {
      focused: manager.isFocused(session.id),
      prefs: data.prefs,
    });
    if (request) notify(request);
  });
  manager.on('sessions', () => send('sessions:changed', snapshotOf(manager)));
  manager.on('data', (id, chunk) => send('terminal:data', id, chunk));
  manager.on('reset', (id) => send('terminal:reset', id));
  manager.on('started', (session) => {
    void changes.sessionStarted(session.id, session.cwd);
    void checkpoints.sessionStarted(session.id);
  });
  manager.on('removed', (id) => {
    notifications.forget(id);
    checks.forget(id);
    queue.forget(id);
    void checkpoints.forget(id);
    void changes.sessionClosed(id);
  });
  manager.on('transition', ({ session, previous }) => {
    // A turn that ended is when the work is photographed and checked, the photo first; a new
    // turn makes any check stale.
    const edge = turnEdge(session.status, previous);
    if (edge === 'ended') {
      void checkpoints.turnEnded(session.id);
      void checks.turnEnded(session.id);
    }
    if (edge === 'started') checks.turnStarted(session.id);
    const request = notifications.evaluate(session, previous, {
      focused: manager.isFocused(session.id),
      prefs: data.prefs,
    });
    if (request) notify(request);
    // After the checks heard of the turn: an item that asks for them takes over their run.
    queue.onTransition(session.id, session.status, previous, session.running);
  });

  let agentsCache: Promise<AgentAvailability[]> | null = null;
  const detectAgents = (refresh: boolean): Promise<AgentAvailability[]> => {
    if (TEST_SHELL) {
      return Promise.resolve(
        Object.values(PROFILES).map((profile) => ({
          profile: profile.id,
          displayName: profile.displayName,
          executable: profile.executable,
          status: 'ok' as const,
          usable: true,
          minVersion: profile.minVersion,
          lastTestedVersion: profile.lastTestedVersion,
          installCommand: profile.installCommand,
        })),
      );
    }
    if (refresh || !agentsCache) {
      agentsCache = Promise.all(Object.values(PROFILES).map((profile) => detectAgent(profile)));
    }
    return agentsCache;
  };

  registerIpc({
    manager,
    changes,
    checks,
    checkpoints,
    queue,
    data,
    discardDir,
    codeThemes: new CodeThemeStore(path.join(userData, 'themes')),
    send,
    testMode: TEST_SHELL,
    gpuMode,
    detectAgents,
    getWindow: () => window,
    setUnsaved: (file) => {
      unsavedFile = file;
    },
    savePrefs: (prefs) => {
      data.prefs = prefs;
      manager.setPreferences(prefs);
      manager.flushPersist();
      send('prefs:changed', prefs);
    },
  });

  let closing = false;
  let reopenAfterClosing = false;
  let unsavedFile: string | null = null;
  const t = (key: MessageKey, params?: MessageParams) =>
    translate(data.prefs.language, key, params);

  /**
   * A yes/no question before closing. In test mode there is nobody to answer a native dialog:
   * the answer comes from AGENT_CONTROLLER_TEST_DIALOGS (default: yes) and the question is
   * recorded, so the tests can check that it was asked.
   */
  const confirmClose = (message: string, detail: string, yes: string): boolean => {
    if (TEST_SHELL) {
      const asked = ((globalThis as Record<string, unknown>).__closeQuestions ??= []) as string[];
      asked.push(`${message}\n${detail}`);
      return process.env.AGENT_CONTROLLER_TEST_DIALOGS !== 'cancel';
    }
    const choice = dialog.showMessageBoxSync(window!, {
      type: 'warning',
      buttons: [yes, t('common.cancel')],
      defaultId: 1,
      cancelId: 1,
      title: t('main.close.title'),
      message,
      detail,
    });
    return choice === 0;
  };
  const shutdown = async () => {
    closing = true;
    metrics.stop();
    changes.dispose();
    checks.dispose();
    if (window && !window.isDestroyed()) saveWindowState(window, data.window);
    // Every agent, and whatever it started, ends with the app (ADR 0006).
    await manager.dispose();
    await hookServer.close();
    try {
      store.save(data);
    } catch {
      // Nothing left to do with the error at this point.
    }
    if (reopenAfterClosing) {
      // Inside an AppImage the executable lives in a mount that goes away with this process.
      const appImage = process.env.APPIMAGE;
      app.relaunch(appImage ? { execPath: appImage, args: process.argv.slice(1) } : undefined);
    }
    app.exit(0);
  };

  const openWindow = () => {
    window = createMainWindow(data.window);
    window.on('focus', () => manager.setWindowFocused(true));
    window.on('blur', () => manager.setWindowFocused(false));
    manager.setWindowFocused(window.isFocused());
    window.on('close', (event) => {
      if (closing) return;
      event.preventDefault();
      if (
        unsavedFile &&
        !confirmClose(
          t('main.close.unsaved'),
          t('main.close.unsavedDetail', { file: unsavedFile }),
          t('main.close.discard'),
        )
      ) {
        return;
      }
      const running = manager.runningSessions();
      if (
        running.length > 0 &&
        !confirmClose(
          running.length === 1
            ? t('main.close.runningOne')
            : t('main.close.runningMany', { count: running.length }),
          running.map((s) => `• ${s.name} (${getProfile(s.profile).displayName})`).join('\n'),
          t('app.closeSession.confirm'),
        )
      ) {
        return;
      }
      window?.hide();
      void shutdown();
    });
  };

  openWindow();
  metrics.start();

  // Fast mode counts as working once the window has been up for a while.
  window!.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (!closing && gpuMode === 'fast') confirmHealthy(userData);
    }, 5000).unref();
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.type === 'GPU' && details.reason !== 'clean-exit' && details.reason !== 'killed') {
      reportGpuFailure(userData, app.getVersion());
    }
  });
  window!.webContents.on('render-process-gone', (_event, details) => {
    // With the GPU in the main process, a renderer lost to a graphics fault is the warning.
    if (gpuMode === 'fast' && details.reason === 'crashed') {
      reportGpuFailure(userData, app.getVersion());
    }
  });

  app.on('second-instance', () => {
    // Opened again while closing: this window would come back only to vanish with the process, and
    // the new instance has already given way. The app starts again once this one is gone.
    if (closing) {
      reopenAfterClosing = true;
      return;
    }
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on('window-all-closed', () => {
    if (!closing) void shutdown();
  });
}
