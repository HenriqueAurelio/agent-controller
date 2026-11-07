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
  shellCommandLine,
  wrapInShell,
} from '@core/agents';
import type { LaunchCommand, LaunchConversation } from '@core/agents';
import { CheckService } from '@core/checks/CheckService';
import { ChangesService } from '@core/git/ChangesService';
import { CheckpointService } from '@core/git/CheckpointService';
import { OverlapService } from '@core/git/OverlapService';
import { repositoryRoot } from '@core/git/GitService';
import { cleanDiscarded } from '@core/git/GitWriteService';
import { MetricsSampler } from '@core/metrics/MetricsSampler';
import { FailureScanner } from '@core/sessions/FailureScanner';
import { TailFeed } from '@core/sessions/TailFeed';
import { ExperimentService } from '@core/experiments/ExperimentService';
import { TaskBoard } from '@core/tasks/TaskBoard';
import { HandoffService } from '@core/handoff/HandoffService';
import { FlowEngine } from '@core/handoff/FlowEngine';
import { ReviewerService } from '@core/handoff/ReviewerService';
import { GitHubClient } from '@core/forges/github';
import { fetchTransport, GitLabClient } from '@core/forges/gitlab';
import { PullWatcher, type PullNotice } from '@core/forges/PullWatcher';
import { PullGuard } from '@core/forges/PullGuard';
import { openThreadsText } from '@core/forges/review';
import { BackgroundService } from '@core/background/BackgroundService';
import { ReviewStore } from '@core/review/ReviewStore';
import { parseCopyPatterns } from '@core/git/copyIntoWorktree';
import { listeningPorts } from '@core/metrics/ports';
import { SonarService } from '@core/sonar/SonarService';
import { SonarConfigStore } from '@core/sonar/SonarConfigStore';
import { currentBranch, headCommit } from '@core/git/GitService';
import { SonarTokens } from './sonarTokens';
import { Preview } from './preview';
import { sendToPhone } from '@core/notify/phonePush';
import { defaultWorktreesFolder } from '@core/git/WorktreeService';
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
import { factoryPrompts } from '@shared/prompts';
import {
  FIX_PIPELINE_PROMPT_ID,
  FIX_PULL_REVIEW_PROMPT_ID,
  GUARD_ATTEMPTS,
  pullRef,
  pullSummary,
  type PullRequestView,
} from '@shared/pulls';
import { REVIEW_PROMPT_ID } from '@shared/reviewer';
import { errorText, translate, UserError, type MessageKey, type MessageParams } from '@shared/i18n';
import { STATUS_DETAIL, type Session, type SessionGroup } from '@shared/session';
import { expandForSession, registerIpc, snapshotOf, type IpcContext } from './ipc';
import { showNotice, showNotification } from './notifications';
import { sessionsForPull } from './pullSessions';
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
  // Keep the old data location after the visual rebrand, so existing sessions and preferences
  // continue to load instead of silently starting from an empty profile.
  const existingUserData = app.getPath('userData');
  app.setName('Aurelium');
  process.title = 'Aurelium';
  if (userDataOverride) app.setPath('userData', userDataOverride);
  else app.setPath('userData', existingUserData);

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.setAppUserModelId('app.aurelium.desktop');
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

  const resolveLaunch = (session: Session, conversation?: LaunchConversation): LaunchCommand => {
    // The command of the session, or the one the preferences give its agent.
    const command = session.command || data.prefs.agentCommands[session.profile];
    if (TEST_SHELL) return testShell(session, hookServer.socketPath, command);
    const profile = getProfile(session.profile);
    const context = { agentctl, dataDirectory: userData, socketPath: hookServer.socketPath };
    // The shell of the user is who finds a command of theirs: the agent need not be on the PATH.
    if (command) {
      return wrapInShell(buildLaunchCommand(profile, session, context, conversation), command);
    }
    const executablePath = findOnPath(profile.executable);
    if (!executablePath) {
      throw new UserError('agent.missing', {
        name: profile.displayName,
        command: profile.installCommand,
      });
    }
    return buildLaunchCommand(profile, session, { ...context, executablePath }, conversation);
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

  // Sessions in other copies of the same repository that change the same files. It looks again
  // when the watcher of an open panel sees a change and at the end of a turn, never more than
  // once every few seconds per repository; it starts no watcher of its own.
  const overlaps = new OverlapService({
    sessions: () =>
      manager.list().map((s) => ({
        id: s.id,
        cwd: s.cwd,
        base: s.worktree?.base,
        running: s.running,
      })),
    settings: () => data.prefs.overlaps,
    onChange: (sessionId, summary) => {
      manager.setOverlaps(sessionId, summary);
      send('git:overlapsChanged', sessionId);
    },
    onError: (err) => console.error('Falha ao cruzar as mudanças das sessões:', err),
  });

  const changes = new ChangesService({
    workDirectory: path.join(userData, 'snapshots'),
    onChange: (sessionId) => {
      send('git:changed', sessionId);
      void overlaps.touch(sessionId);
    },
  });
  // Snapshots of a previous run are useless: sessions always come back stopped. A git of that
  // run may still hold a file there on Windows; what is left is harmless, so it must not stop
  // the app from opening.
  try {
    fs.rmSync(path.join(userData, 'snapshots'), { recursive: true, force: true });
  } catch (err) {
    console.error('Falha ao limpar os snapshots da execução anterior:', err);
  }
  // Copies of what the panel discarded, kept a month for "undo". The tests keep theirs apart.
  const discardDir = TEST_SHELL
    ? path.join(userData, 'descartados')
    : path.join(os.homedir(), '.agent-controller', 'descartados');
  void cleanDiscarded(discardDir);

  const metrics = new MetricsSampler({
    // The ports of a dev server a session started show with it.
    ports: () => listeningPorts(),
    // The tests wait for a port to show: they read it at every sample.
    portsEvery: TEST_SHELL ? 1 : 3,
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

  // The last lines of each session, for the overview: read only while it is open.
  const tails = new TailFeed({
    sessionIds: () => manager.list().map((session) => session.id),
    outputSeq: (id) => manager.outputSeq(id),
    tail: (id, lines) => manager.tail(id, lines),
    onTails: (batch) => send('sessions:tails', batch),
    onError: (err) => console.error('Falha ao ler as últimas linhas das sessões:', err),
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
  // The same notices on the phone (ADR 0033): only the title and the short line.
  const phoneTokens = new SonarTokens(path.join(userData, 'phone-token.json'));
  const sendPhone = (title: string, body: string) => {
    const settings = data.prefs.phone;
    const token = settings.provider === 'telegram' ? phoneTokens.get('telegram') : null;
    return sendToPhone(settings, { title, body }, token);
  };
  const pushPhone = (title: string, body: string) => {
    const settings = data.prefs.phone;
    if (settings.provider === 'off') return;
    if (settings.onlyWhenAway && window && !window.isDestroyed() && window.isFocused()) return;
    void sendPhone(title, body).then((error) => {
      if (error) console.error('Falha ao avisar no celular:', error);
    });
  };
  const notify = (request: NotificationRequest) => {
    pushPhone(request.title, request.body);
    notifyHere(request);
  };
  const notifyHere = (request: NotificationRequest) =>
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
    flows.asking(session.id);
    const request = notifications.evaluatePermission(session, {
      focused: manager.isFocused(session.id),
      prefs: data.prefs,
    });
    if (request) notify(request);
  });
  // What the warning depends on in the list: which sessions, in which folders, running or not.
  let overlapShape = '';
  manager.on('sessions', () => {
    send('sessions:changed', snapshotOf(manager));
    const shape = manager
      .list()
      .map((s) => [s.id, s.cwd, s.worktree?.base ?? '', s.running].join('|'))
      .join('\n');
    if (shape === overlapShape) return;
    overlapShape = shape;
    void overlaps.refreshAll();
  });
  manager.on('data', (id, chunk) => send('terminal:data', id, chunk));
  manager.on('reset', (id) => send('terminal:reset', id));
  manager.on('resync', (id, data) => send('terminal:resync', id, data));
  manager.on('started', (session) => {
    void changes.sessionStarted(session.id, session.cwd);
    void checkpoints.sessionStarted(session.id);
  });
  manager.on('removed', (id) => {
    notifications.forget(id);
    checks.forget(id);
    queue.forget(id);
    overlaps.forget(id);
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
      void overlaps.touch(session.id);
      reviewer.turnEnded(session.id);
      flows.turnEnded(session.id);
    }
    if (edge === 'started') {
      checks.turnStarted(session.id);
      reviewer.turnStarted(session.id);
    }
    // The agent asks the user something that is not its prompt: the flow waits for the answer.
    if (
      session.status.state === 'aguardando' &&
      session.status.confirmed &&
      session.status.detail !== STATUS_DETAIL.ready &&
      session.status.detail !== STATUS_DETAIL.idle &&
      session.status.detail !== STATUS_DETAIL.unconfirmed
    ) {
      flows.asking(session.id);
    }
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

  const experiments = new ExperimentService({
    manager,
    file: path.join(userData, 'experiments.json'),
    worktrees: () => ({
      parent: data.worktrees.folder || defaultWorktreesFolder(),
      setup: data.worktrees.setup,
      copy: parseCopyPatterns(data.worktrees.copy),
    }),
    // The watcher of the panel holds the folder open; on Windows that keeps it from going.
    beforeRemove: async (sessionId) => {
      changes.close(sessionId);
      await checkpoints.removeAll(sessionId).catch(() => 0);
    },
    describeError: (err) => errorText(data.prefs.language, err),
  });

  // The cards that become sessions; a card's column is read from its session (ADR 0025).
  const tasks = new TaskBoard({
    manager,
    dir: path.join(userData, 'tasks'),
    worktrees: () => ({
      parent: data.worktrees.folder || defaultWorktreesFolder(),
      setup: data.worktrees.setup,
      copy: parseCopyPatterns(data.worktrees.copy),
    }),
    describeError: (err) => errorText(data.prefs.language, err),
  });
  tasks.on('changed', (repo) => send('tasks:changed', repo));

  // What goes to the reviewer and what comes back is files in a folder of the app, outside the
  // repositories (ADR 0023). The tests keep theirs apart.
  const handoff = new HandoffService({
    root: TEST_SHELL
      ? path.join(userData, 'handoffs')
      : path.join(os.homedir(), '.agent-controller', 'handoffs'),
    stableMs: TEST_SHELL ? 300 : undefined,
    pollMs: TEST_SHELL ? 100 : undefined,
  });
  void handoff.cleanOld();
  // Fallback is intentionally owned by the app layer: SessionManager stays a small PTY primitive.
  // An exhausted agent may reject one final request, so the package comes from local evidence.
  const fallbackSeen = new Set<string>();
  const lastPrompt = new Map<string, string>();
  const terminalLine = new Map<string, string>();
  const failures = new FailureScanner();
  const runFallback = async (sourceId: string, reason: 'usage' | 'provider' | 'unexpected') => {
    if (fallbackSeen.has(sourceId)) return;
    const policy = data.prefs.fallback;
    if (!policy.enabled || !policy.triggers[reason]) return;
    const source = manager.get(sourceId);
    if (!source) return;
    const index = policy.chain.findIndex((target) => target.profile === source.profile);
    const target = policy.chain.slice(index < 0 ? 0 : index + 1)[0];
    if (!target) return;
    fallbackSeen.add(sourceId);
    const [tailLines, overview] = await Promise.all([
      manager.tail(sourceId, 80),
      changes.overview(sourceId, source.cwd, 'session').catch(() => null),
    ]);
    const tail = tailLines.join('\n');
    const changedFiles =
      overview?.ok && overview.changes.length
        ? overview.changes.map((change) => `- ${change.path}`).join('\n')
        : 'No changed files could be determined.';
    const id = `${Date.now()}-${sourceId}`;
    const folder = path.join(userData, 'fallback-handoffs', id);
    const handoffText = [
      '# Agent fallback handoff',
      '',
      `Reason: ${reason}`,
      `Source: ${source.profile}`,
      `Destination: ${target.profile}`,
      '',
      '## Original request',
      lastPrompt.get(sourceId) || 'Not available: the request was typed directly in the terminal.',
      '',
      '## Where work stopped',
      tail || 'No terminal output was retained.',
      '',
      '## Changed files',
      changedFiles,
      '',
      '## Decisions and next step',
      'Inspect the repository state and git diff, then continue the original task. Verify what is complete before editing.',
    ].join('\n');
    await fs.promises.mkdir(folder, { recursive: true });
    const handoffFile = path.join(folder, 'handoff.md');
    await fs.promises.writeFile(handoffFile, handoffText, 'utf8');
    if (policy.mode === 'confirm' && !TEST_SHELL) {
      const choice = await dialog.showMessageBox(window!, {
        type: 'warning',
        buttons: [t('fallback.continue'), t('common.cancel')],
        defaultId: 0,
        cancelId: 1,
        title: t('fallback.title'),
        message: t('fallback.confirm', {
          name: source.name,
          agent: getProfile(target.profile).displayName,
        }),
        detail: handoffText.slice(0, 3500),
      });
      if (choice.response !== 0) return;
    }
    const next = manager.create({
      name: `${source.name} (fallback)`,
      cwd: source.cwd,
      profile: target.profile,
      ...(source.groupId && { groupId: source.groupId }),
      model: target.model,
      reasoning: target.reasoning,
      keepSelection: false,
    });
    manager.start(next.id);
    manager.sendText(
      next.id,
      `Continue the work described below. The original session stopped and may be incomplete. Read ${handoffFile}, inspect the repository and git diff, then continue from the next step.\n\n${handoffText}`,
      { submit: true },
    );
  };
  const rememberPrompt = (id: string, text: string) => {
    const prompt = text
      .replaceAll('\x1b[200~', '')
      .replaceAll('\x1b[201~', '')
      .replace(/\s+/g, ' ')
      .trim();
    if (prompt && !lastPrompt.has(id)) lastPrompt.set(id, prompt);
  };
  manager.on('sentText', rememberPrompt);
  manager.on('input', (id, data) => {
    if (lastPrompt.has(id)) return;
    const session = manager.list().find((item) => item.id === id);
    // Only retain the first line submitted at the agent's normal prompt. This excludes answers
    // to permission menus and later interactive replies while still allowing normal terminal use.
    if (
      !session ||
      session.status.state !== 'aguardando' ||
      !session.status.confirmed ||
      (session.status.detail !== STATUS_DETAIL.ready &&
        session.status.detail !== STATUS_DETAIL.idle)
    ) {
      return;
    }
    const before = terminalLine.get(id) ?? '';
    const combined = `${before}${data}`;
    const breakAt = combined.search(/[\r\n]/);
    if (breakAt < 0) {
      terminalLine.set(id, combined.slice(0, 60_000));
      return;
    }
    terminalLine.delete(id);
    rememberPrompt(id, combined.slice(0, breakAt));
  });
  manager.on('output', (id, chunk) => {
    // The fallback is off by default: then, and once a session already fell back, nothing is
    // read. Output arrives in thousands of chunks a second while agents draw.
    const { enabled, triggers } = data.prefs.fallback;
    if (!enabled || (!triggers.usage && !triggers.provider) || fallbackSeen.has(id)) {
      failures.forget(id);
      return;
    }
    const reason = failures.feed(id, chunk);
    if (reason && triggers[reason])
      void runFallback(id, reason).catch((err) => console.error('Fallback failed:', err));
  });
  manager.on('transition', ({ session, previous }) => {
    if (previous.state === 'trabalhando' && session.status.state === 'erro')
      void runFallback(session.id, 'unexpected').catch((err) =>
        console.error('Fallback failed:', err),
      );
  });
  const reviewer = new ReviewerService({
    manager,
    checkpoints,
    handoff,
    file: path.join(userData, 'reviewers.json'),
    // The saved prompt, if the user kept it in their list; the factory one otherwise.
    prompt: () => {
      const language = data.prefs.language;
      const saved = data.prefs.prompts.find((p) => p.id === REVIEW_PROMPT_ID);
      return (saved ?? factoryPrompts(language).find((p) => p.id === REVIEW_PROMPT_ID))?.text ?? '';
    },
    expand: (sessionId, text) => expandForSession(manager, sessionId, text, {}),
    hasTurnChecks: (sessionId) => {
      const session = manager.get(sessionId);
      const configured = session ? (data.checks[folderKey(session.cwd)] ?? []) : [];
      return configured.some((check) => check.onTurnEnd);
    },
    reviewerName: (target) =>
      translate(data.prefs.language, 'reviewer.sessionName', { name: target.name }),
    describeError: (err) => errorText(data.prefs.language, err),
  });
  reviewer.on('changed', (sessionId) => send('reviewer:changed', sessionId));
  checks.on('changed', (sessionId, run) => {
    // The review of a turn waits for the checks of the turn, and only goes if they passed.
    if (run?.trigger !== 'turnEnd' || run.state !== 'done') return;
    reviewer.checksFinished(sessionId, summarizeRun(run).state === 'passed' ? 'passed' : 'failed');
  });

  // Rules that send from one session to another; the queue of the destination delivers them.
  const flows = new FlowEngine({
    manager,
    handoff,
    checkpoints,
    queue,
    expand: (sessionId, text) => expandForSession(manager, sessionId, text, {}),
    describeError: (err) => errorText(data.prefs.language, err),
    watchMs: TEST_SHELL ? 2000 : undefined,
  });
  flows.on('changed', (groupId) => send('flows:changed', groupId));
  flows.start();
  checks.on('changed', (sessionId, run) => {
    if (run?.trigger !== 'turnEnd' || run.state !== 'done') return;
    flows.checksFinished(sessionId, summarizeRun(run).state === 'passed' ? 'passed' : 'failed');
  });

  // The pull requests of the watched repositories (docs/v2/acompanhar-prs). The tests point the
  // clients at a fake GitHub and a fake GitLab of their own; only in test mode, or the token of
  // `gh` could be sent to whatever address the environment names.
  // A test without a fake GitLab gets an address that refuses, never the user's own glab.
  const fakeGitLab = TEST_SHELL
    ? process.env.AGENT_CONTROLLER_GITLAB_API || 'http://127.0.0.1:1'
    : undefined;
  const pulls = new PullWatcher({
    clients: {
      github: new GitHubClient(
        TEST_SHELL
          ? {
              apiUrl: process.env.AGENT_CONTROLLER_GITHUB_API || undefined,
              token: process.env.AGENT_CONTROLLER_GITHUB_TOKEN || undefined,
              runAccounts: async () => {
                // "ana*,bruno": the starred one is the active.
                const names = (process.env.AGENT_CONTROLLER_GH_ACCOUNTS ?? '')
                  .split(',')
                  .filter(Boolean);
                return {
                  accounts: names.map((n) => n.replace(/\*$/, '')),
                  active: names.find((n) => n.endsWith('*'))?.replace(/\*$/, '') ?? '',
                };
              },
            }
          : {},
      ),
      gitlab: new GitLabClient(
        fakeGitLab
          ? fetchTransport(fakeGitLab, process.env.AGENT_CONTROLLER_GITLAB_TOKEN ?? '')
          : undefined,
      ),
    },
    intervalMs:
      TEST_SHELL && process.env.AGENT_CONTROLLER_PULLS_MS
        ? Number(process.env.AGENT_CONTROLLER_PULLS_MS)
        : undefined,
    describeError: (err) => errorText(data.prefs.language, err),
  });
  pulls.configure(data.prefs.pulls);
  pulls.on('changed', (state) => send('pulls:changed', state));
  const pullNotice = ({ kind, pull }: PullNotice) => {
    const settings = data.prefs.pulls;
    const wanted =
      kind === 'failed'
        ? settings.notifyFailed
        : kind === 'comment'
          ? settings.notifyComments
          : settings.notifyReview;
    if (!wanted) return;
    const where = pullRef(pull);
    const failed = pull.pipeline.jobs.filter((j) => j.state === 'failure').map((j) => j.name);
    showNotice(
      `pull:${pull.key}`,
      {
        title:
          kind === 'failed'
            ? t('pulls.notice.failed', { pull: where })
            : kind === 'comment'
              ? t('pulls.notice.comment', { pull: where, author: pull.lastCommentBy ?? '' })
              : t('pulls.notice.review', { pull: where, author: pull.author }),
        body:
          kind === 'failed' && failed.length > 0
            ? `${pull.title}\n${failed.slice(0, 3).join(', ')}`
            : pull.title,
        silent: !data.prefs.notifySound,
      },
      () => {
        if (!window || window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        send('pulls:focus', pull.key);
      },
    );
  };
  pulls.on('notice', pullNotice);

  // The guard of my pull requests: a failed pipeline goes to the agent of its branch by itself.
  const guard = new PullGuard();
  guard.configure(data.prefs.pulls.guarded ?? []);
  pulls.on('notice', (notice) => guard.notice(notice));
  pulls.on('changed', (state) => guard.update(state));
  guard.on('changed', (state) => send('pulls:guardChanged', state));
  const openPull = (pull: PullRequestView) => () => {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    send('pulls:focus', pull.key);
  };
  const guardNotice = (pull: PullRequestView, title: string, body: string) => {
    pushPhone(title, body);
    showNotice(
      `guard:${pull.key}`,
      { title, body, silent: !data.prefs.notifySound },
      openPull(pull),
    );
  };
  /** The fix each guard put in a queue: a newer failure replaces it while it has not gone. */
  const guardItems = new Map<string, { session: string; item: string }>();
  guard.on('fix', (pull) => {
    void (async () => {
      const ids = await sessionsForPull(manager, pull);
      const target = ids.find((id) => manager.isRunning(id)) ?? ids[0];
      const where = pullRef(pull);
      if (!target) {
        guard.sent(pull.key, null);
        guardNotice(pull, t('pulls.guard.notice.noSession', { pull: where }), pull.branch);
        return;
      }
      const pipeline = await pulls.failureText(pull.key);
      // A user who deleted or never had the factory prompt still gets its text.
      const prompt =
        data.prefs.prompts.find((p) => p.id === FIX_PIPELINE_PROMPT_ID) ??
        factoryPrompts(data.prefs.language).find((p) => p.id === FIX_PIPELINE_PROMPT_ID)!;
      const previous = guardItems.get(pull.key);
      if (previous && queue.get(previous.session).items.some((i) => i.id === previous.item)) {
        queue.remove(previous.session, previous.item);
      }
      try {
        const item = queue.add(target, {
          text: prompt.text,
          values: { pr: pullSummary(pull), pipeline },
          condition: 'turnEnd',
        });
        guardItems.set(pull.key, { session: target, item: item.id });
      } catch {
        guard.sent(pull.key, null);
        return;
      }
      guard.sent(pull.key, target);
      const attempts = guard.get()[pull.key]?.attempts ?? 1;
      guardNotice(
        pull,
        t('pulls.guard.notice.sent', { pull: where }),
        t('pulls.guard.notice.sentBody', {
          session: manager.get(target)?.name ?? '',
          attempt: attempts,
          limit: GUARD_ATTEMPTS,
        }),
      );
    })().catch(() => guard.sent(pull.key, null));
  });
  guard.on('comments', (pull) => {
    void (async () => {
      const ids = await sessionsForPull(manager, pull);
      const target = ids.find((id) => manager.isRunning(id)) ?? ids[0];
      if (!target) return;
      const me = pulls.get().logins[pull.forge] ?? '';
      const review = openThreadsText(await pulls.review(pull.key), me);
      // Only resolved conversations, or the user's own notes: nothing for the agent to do.
      if (!review) return;
      const prompt =
        data.prefs.prompts.find((p) => p.id === FIX_PULL_REVIEW_PROMPT_ID) ??
        factoryPrompts(data.prefs.language).find((p) => p.id === FIX_PULL_REVIEW_PROMPT_ID)!;
      queue.add(target, {
        text: prompt.text,
        values: { pr: pullSummary(pull), review },
        condition: 'turnEnd',
      });
      guardNotice(
        pull,
        t('pulls.guard.notice.comments', { pull: pullRef(pull) }),
        t('pulls.guard.notice.commentsBody', { session: manager.get(target)?.name ?? '' }),
      );
    })().catch(() => {});
  });
  guard.on('gaveUp', (pull) =>
    guardNotice(
      pull,
      t('pulls.guard.notice.gaveUp', { pull: pullRef(pull) }),
      t('pulls.guard.notice.gaveUpBody', { limit: GUARD_ATTEMPTS }),
    ),
  );

  // Commands in the background, apart from the sessions (docs/v2/comandos-em-segundo-plano).
  // In test mode the shell starts without the user's profile.
  const background = new BackgroundService({
    launch: (command) => shellCommandLine(command, { profile: !TEST_SHELL }),
  });
  background.on('changed', (state) => send('background:changed', state));
  const review = new ReviewStore({ file: path.join(userData, 'review.json') });
  review.on('changed', (sessionId, comments) => send('review:changed', sessionId, comments));
  manager.on('removed', (id) => review.forget(id));

  // Sonar (docs/planos/sonar-por-grupo-e-worktree.md): set up per group, analysed per session.
  const sonarService = new SonarService({
    workDirectory: path.join(userData, 'sonar-work'),
    describeError: (err) => errorText(data.prefs.language, err),
  });
  const sonarConfigs = new SonarConfigStore(path.join(userData, 'sonar.json'));
  const sonarTokens = new SonarTokens(path.join(userData, 'sonar-tokens.json'));
  sonarService.on('changed', (sessionId, run) => send('sonar:changed', sessionId, run));
  // The preview of a local page, over the place of the terminal (ADR 0031).
  const preview = new Preview(
    () => window,
    (state) => send('preview:changed', state),
  );
  const startSonar = async (sessionId: string) => {
    const s = manager.get(sessionId);
    const config = s?.groupId ? sonarConfigs.get(s.groupId) : null;
    if (!s || !s.groupId || !config || !config.enabled) {
      throw new UserError('error.sonar.notConfigured');
    }
    const token = sonarTokens.get(s.groupId);
    if (!token) throw new UserError('error.sonar.noToken');
    const [branch, commit] = await Promise.all([
      currentBranch(s.cwd).catch(() => null),
      headCommit(s.cwd).catch(() => null),
    ]);
    sonarService.start({
      sessionId,
      repoKey: s.groupId,
      cwd: s.cwd,
      branch,
      commit,
      config,
      token,
    });
  };
  manager.on('removed', (id) => sonarService.forget(id));
  manager.on('transition', ({ session, previous }) => {
    const edge = turnEdge(session.status, previous);
    if (edge === 'started') sonarService.cancel(session.id);
    if (edge !== 'ended' || !session.groupId) return;
    const config = sonarConfigs.get(session.groupId);
    if (config?.enabled && config.onTurnEnd) void startSonar(session.id).catch(() => {});
  });
  background.on('data', (id, chunk) => send('background:data', id, chunk));
  background.on('notice', ({ command, exitCode }) => {
    showNotice(
      `background:${command.id}`,
      {
        title: t('background.notice.exited', { name: command.name }),
        body: t('background.notice.exitedBody', { command: command.command, code: exitCode }),
        silent: !data.prefs.notifySound,
      },
      () => {
        if (!window || window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        send('background:focus', command.id);
      },
    );
  });

  registerIpc({
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
    tails,
    pulls,
    guard,
    background,
    review,
    preview,
    shotsDir: path.join(userData, 'shots'),
    phone: { tokens: phoneTokens, send: sendPhone },
    sonar: {
      service: sonarService,
      configs: sonarConfigs,
      tokens: sonarTokens,
      start: startSonar,
    },
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
      const overlapsBefore = JSON.stringify(data.prefs.overlaps);
      data.prefs = prefs;
      if (JSON.stringify(prefs.overlaps) !== overlapsBefore) void overlaps.refreshAll();
      manager.setPreferences(prefs);
      pulls.configure(prefs.pulls);
      guard.configure(prefs.pulls.guarded ?? []);
      background.configure(prefs.background);
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
    tails.dispose();
    changes.dispose();
    overlaps.dispose();
    sonarService.dispose();
    reviewer.dispose();
    flows.dispose();
    tasks.dispose();
    pulls.dispose();
    checks.dispose();
    // Every background command ends with the app: no proxy is left holding a port.
    await background.dispose();
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
  pulls.start();
  // The ones left on start with the app.
  background.configure(data.prefs.background);

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
