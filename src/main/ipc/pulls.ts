// The channels of pull requests, of the branch of a copy on its way to one, of Sonar and of the
// notices on the phone: the services outside the machine the app reads and, on a click, writes.
import { headCommit } from '@core/git/GitService';
import { branchState, pushBranch, updateFromBase } from '@core/git/BranchFlow';
import { pullBody, type BranchInfo } from '@shared/branch';
import { sessionsForPull } from '../pullSessions';
import { SonarApi } from '@core/sonar/SonarApi';
import { sanitizeSonarConfig, SONAR_TOKEN_LIMIT, type SonarGroupInfo } from '@shared/sonar';
import { UserError } from '@shared/i18n';
import { sanitizePreferences } from '@shared/prefs';
import { FORGES, normalizeRepo, pullSummary } from '@shared/pulls';
import { MERGE_METHODS, PULL_TITLE_LIMIT, REVIEW_BODY_LIMIT } from '@shared/pullReview';
import type { IpcKit } from './kit';
import { str, submission } from './args';

export function registerPullsIpc(kit: IpcKit): void {
  const { context, handle, session, t, manager, tasks } = kit;
  /** A session in a copy, its branch and how it stands; anything else has no pull request here. */
  const copyBranch = async (id: unknown) => {
    const s = session(id);
    if (!s.worktree) throw new UserError('error.branch.notCopy');
    const state = await branchState(s.cwd, s.worktree.base);
    const repo = state.remoteUrl ? normalizeRepo(state.remoteUrl) : null;
    return { s, state, repo };
  };
  handle('branch:info', async (id): Promise<BranchInfo> => {
    const { s, state, repo } = await copyBranch(id);
    const card = tasks.findBySession(s.id);
    const issue = card?.issue ?? null;
    const sonar = s.groupId ? context.sonar.configs.get(s.groupId) : null;
    return {
      branch: state.branch,
      head: (await headCommit(s.cwd).catch(() => null)) ?? '',
      sonarBeforePull: Boolean(sonar?.enabled && sonar.beforePull),
      base: state.base,
      ahead: state.ahead,
      subjects: state.subjects,
      dirty: state.dirty,
      behind: state.behind,
      stackedOn:
        manager.list().find((other) => other.id !== s.id && other.worktree?.branch === state.base)
          ?.name ?? null,
      remote: state.remote,
      repo,
      title: (card?.title ?? state.subjects[0] ?? state.branch).slice(0, PULL_TITLE_LIMIT),
      body: pullBody(state.subjects, issue),
      issue,
    };
  });
  handle('branch:openPull', async (id, input) => {
    const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const title = str(v.title, 'name', PULL_TITLE_LIMIT).trim();
    if (!title) throw new UserError('error.branch.noTitle');
    const body = str(v.body ?? '', 'text', REVIEW_BODY_LIMIT);
    const { s, state, repo } = await copyBranch(id);
    if (!state.remote || !repo) throw new UserError('error.branch.noRemote');
    if (state.ahead === 0) throw new UserError('error.branch.nothingToPush');
    await pushBranch(s.cwd, state.remote, state.branch);
    const opened = await context.pulls.createPull(repo, {
      title,
      body,
      head: state.branch,
      base: state.base,
      draft: v.draft === true,
    });
    // The pull request shows in the panel from now on, and can be guarded.
    const prefs = context.data.prefs;
    if (!prefs.pulls.repos.some((r) => r.toLowerCase() === repo.toLowerCase())) {
      context.savePrefs(
        sanitizePreferences({
          ...prefs,
          pulls: { ...prefs.pulls, repos: [...prefs.pulls.repos, repo] },
        }),
      );
    }
    return opened;
  });
  handle('branch:updateFromBase', async (id) => {
    const { s, state } = await copyBranch(id);
    const result = await updateFromBase(s.cwd, state.base, state.remote);
    return result;
  });
  handle('pulls:get', () => context.pulls.get());
  handle('pulls:refresh', async () => {
    await context.pulls.refresh();
    return context.pulls.get();
  });
  handle('pulls:available', (forge) => {
    if (!FORGES.includes(forge)) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.forge' } });
    }
    return context.pulls.available(forge);
  });
  handle('pulls:accounts', () => context.pulls.ghAccounts());
  handle('pulls:fixPipeline', async (key) => {
    const value = str(key, 'pull', 300);
    const pull = context.pulls.find(value);
    if (!pull) throw new UserError('error.pulls.notFound');
    const pipeline = await context.pulls.failureText(pull.key);
    if (!pipeline) throw new UserError('error.pulls.nothingFailed');
    return { pr: pullSummary(pull), pipeline, sessions: await sessionsForPull(manager, pull) };
  });
  handle('pulls:review', (key) => context.pulls.review(str(key, 'pull', 300)));
  handle('pulls:submitReview', (key, value) =>
    context.pulls.submitReview(str(key, 'pull', 300), submission(value)),
  );
  handle('pulls:merge', (key, options) => {
    const o = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>;
    const method = MERGE_METHODS.find((m) => m === o.method) ?? 'squash';
    return context.pulls.merge(str(key, 'pull', 300), {
      method,
      deleteBranch: o.deleteBranch === true,
    });
  });
  const sonarGroup = (groupId: string): SonarGroupInfo => ({
    config: context.sonar.configs.get(groupId),
    hasToken: context.sonar.tokens.has(groupId),
    secureStorage: context.sonar.tokens.available(),
  });
  const knownGroup = (id: unknown) => {
    const groupId = str(id, 'group', 64);
    if (!manager.listGroups().some((g) => g.id === groupId)) {
      throw new UserError('error.invalidArgument', { name: { key: 'arg.group' } });
    }
    return groupId;
  };
  const sonarConfig = (value: unknown) => {
    const config = sanitizeSonarConfig(value);
    if (!config) throw new UserError('error.sonar.badConfig');
    return config;
  };
  handle('sonar:group', (id) => sonarGroup(knownGroup(id)));
  handle('sonar:configure', (id, config, token) => {
    const groupId = knownGroup(id);
    context.sonar.configs.set(groupId, config === null ? null : sonarConfig(config));
    if (token === null || config === null) {
      if (context.sonar.tokens.has(groupId)) context.sonar.tokens.set(groupId, null);
    } else if (token !== undefined) {
      const value = str(token, 'text', SONAR_TOKEN_LIMIT).trim();
      if (value) {
        if (!context.sonar.tokens.available()) throw new UserError('error.sonar.noVault');
        context.sonar.tokens.set(groupId, value);
      }
    }
    return sonarGroup(groupId);
  });
  handle('sonar:test', async (id, config, token) => {
    const groupId = knownGroup(id);
    const given = token === undefined ? '' : str(token, 'text', SONAR_TOKEN_LIMIT).trim();
    const value = given || context.sonar.tokens.get(groupId);
    if (!value) return { ok: false, error: t('error.sonar.noToken') };
    try {
      await new SonarApi(sonarConfig(config), value).test();
      return { ok: true };
    } catch (err) {
      const status = (err as { status?: number | null }).status;
      return {
        ok: false,
        error:
          status === 401
            ? t('error.sonar.badToken')
            : status === 404
              ? t('error.sonar.noProject')
              : err instanceof Error
                ? err.message
                : String(err),
      };
    }
  });
  handle('sonar:run', (id) => context.sonar.start(session(id).id));
  handle('sonar:runGroup', async (id) => {
    const groupId = knownGroup(id);
    for (const s of manager.list().filter((s) => s.groupId === groupId)) {
      await context.sonar.start(s.id);
    }
  });
  handle('sonar:runs', () => context.sonar.service.all());
  const phoneInfo = () => ({
    hasToken: context.phone.tokens.has('telegram'),
    secureStorage: context.phone.tokens.available(),
  });
  handle('phone:info', phoneInfo);
  handle('phone:setToken', (token) => {
    if (token === null) {
      if (context.phone.tokens.has('telegram')) context.phone.tokens.set('telegram', null);
    } else {
      const value = str(token, 'text', 200).trim();
      if (!/^\d+:[\w-]{20,}$/.test(value)) throw new UserError('error.phone.badToken');
      if (!context.phone.tokens.available()) throw new UserError('error.sonar.noVault');
      context.phone.tokens.set('telegram', value);
    }
    return phoneInfo();
  });
  handle('phone:test', () => context.phone.send(t('phone.testTitle'), t('phone.testBody')));
  handle('pulls:guard', () => context.guard.get());
  handle('pulls:setGuard', (key, on) => {
    const value = str(key, 'pull', 300);
    const prefs = context.data.prefs;
    const guarded = new Set(prefs.pulls.guarded ?? []);
    if (on === true) guarded.add(value);
    else guarded.delete(value);
    context.savePrefs(
      sanitizePreferences({ ...prefs, pulls: { ...prefs.pulls, guarded: [...guarded] } }),
    );
    if (on === true) context.guard.started(context.pulls.find(value));
  });
}
