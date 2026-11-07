// The pull requests of the watched repositories, the notices about them, and the guard that
// sends a failed pipeline or new review comments to the agent of the branch. Started by startApp.
import type { BrowserWindow } from 'electron';
import { GitHubClient } from '@core/forges/github';
import { fetchTransport, GitLabClient } from '@core/forges/gitlab';
import { PullGuard } from '@core/forges/PullGuard';
import { PullWatcher, type PullNotice } from '@core/forges/PullWatcher';
import { openThreadsText } from '@core/forges/review';
import type { PromptQueue } from '@core/prompts/PromptQueue';
import type { SessionManager } from '@core/sessions/SessionManager';
import type { AppData } from '@core/store/appStore';
import { errorText, translate, type MessageKey, type MessageParams } from '@shared/i18n';
import { factoryPrompts } from '@shared/prompts';
import {
  FIX_PIPELINE_PROMPT_ID,
  FIX_PULL_REVIEW_PROMPT_ID,
  GUARD_ATTEMPTS,
  pullRef,
  pullSummary,
  type PullRequestView,
} from '@shared/pulls';
import type { IpcContext } from './ipc';
import { showNotice } from './notifications';
import { sessionsForPull } from './pullSessions';

export interface PullWatchOptions {
  data: AppData;
  /** The tests point the clients at fakes of their own: only in test mode. */
  testMode: boolean;
  send: IpcContext['send'];
  /** The same notice on the phone, when the user set it up. */
  pushPhone(title: string, body: string): void;
  getWindow(): BrowserWindow | null;
  manager: SessionManager;
  queue: PromptQueue;
}

export function startPullWatch({
  data,
  testMode,
  send,
  pushPhone,
  getWindow,
  manager,
  queue,
}: PullWatchOptions): { pulls: PullWatcher; guard: PullGuard } {
  const t = (key: MessageKey, params?: MessageParams) =>
    translate(data.prefs.language, key, params);

  // The pull requests of the watched repositories (docs/v2/acompanhar-prs). The tests point the
  // clients at a fake GitHub and a fake GitLab of their own; only in test mode, or the token of
  // `gh` could be sent to whatever address the environment names.
  // A test without a fake GitLab gets an address that refuses, never the user's own glab.
  const fakeGitLab = testMode
    ? process.env.AGENT_CONTROLLER_GITLAB_API || 'http://127.0.0.1:1'
    : undefined;
  const pulls = new PullWatcher({
    clients: {
      github: new GitHubClient(
        testMode
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
      testMode && process.env.AGENT_CONTROLLER_PULLS_MS
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
        const window = getWindow();
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
    const window = getWindow();
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

  return { pulls, guard };
}
