// One pull request of the panel: its pipeline, its jobs, and what can be done with it.
import { GUARD_ATTEMPTS, type GuardEntry, type PullRequestView } from '@shared/pulls';
import { useT } from '../lib/i18n';
import { duration } from './Overview';

const openSite = (url: string) => void window.api.invoke('shell:openExternal', url);

export interface PullSonar {
  status: 'passed' | 'failed';
  /** The session whose analysis it was. */
  session: string;
}

export function PullRow({
  pull,
  now,
  focused,
  fixing,
  onFix,
  guard,
  onGuard,
  onReview,
  sonar,
}: {
  pull: PullRequestView;
  /** What Sonar said of the head commit, when the app analysed it. */
  sonar: PullSonar | undefined;
  now: number;
  focused: boolean;
  fixing: boolean;
  onFix(): void;
  /** The guard of this pull request, when it is on. */
  guard: GuardEntry | undefined;
  onGuard(on: boolean): void;
  onReview(): void;
}) {
  const t = useT();
  const { state, jobs } = pull.pipeline;
  const failed = jobs.filter((j) => j.state === 'failure');
  const counted = jobs.filter((j) => j.state !== 'skipped');
  const passed = counted.filter((j) => j.state === 'success').length;
  const updated = Date.parse(pull.updatedAt);
  return (
    <article
      className={`pull-row ${focused ? 'focused' : ''}`}
      data-testid="pull-row"
      data-key={pull.key}
      data-pipeline={state}
      data-mine={pull.mine}
    >
      <div className="pull-line">
        <span
          className={`pipeline-dot pipeline-${state}`}
          title={t(`pulls.pipeline.${state}`)}
          aria-label={t(`pulls.pipeline.${state}`)}
        />
        <a
          href={pull.url}
          className="pull-title"
          title={t('pulls.openSite', { service: t(`pulls.forge.${pull.forge}`) })}
          onClick={(e) => {
            e.preventDefault();
            openSite(pull.url);
          }}
        >
          <span className="muted">
            {pull.forge === 'gitlab' ? '!' : '#'}
            {pull.number}
          </span>{' '}
          {pull.title}
        </a>
        {pull.draft && <span className="pull-tag">{t('pulls.draft')}</span>}
        {pull.review && (
          <span className={`pull-tag review-${pull.review}`}>
            {t(`pulls.review.${pull.review}`)}
          </span>
        )}
        {pull.reviewRequested && (
          <span className="pull-tag review-me">{t('pulls.reviewRequested')}</span>
        )}
        {sonar && (
          <span
            className={`pull-tag sonar-${sonar.status}`}
            data-testid="pull-sonar"
            data-status={sonar.status}
            title={t('pulls.sonar.hint', { name: sonar.session })}
          >
            {t(`pulls.sonar.${sonar.status}`)}
          </span>
        )}
        <span className="spacer" />
        <button
          className="pull-review-button"
          data-testid="pull-review-open"
          title={t('pullReview.openHint')}
          onClick={onReview}
        >
          {t('pullReview.open')}
        </button>
        {pull.mine && (
          <>
            {guard && (
              <span
                className={`pull-tag guard-${guard.status}`}
                data-testid="pull-guard-status"
                data-status={guard.status}
              >
                {guard.status === 'sent'
                  ? t('pulls.guard.sent', { attempt: guard.attempts, limit: GUARD_ATTEMPTS })
                  : guard.status === 'noSession'
                    ? t('pulls.guard.noSession')
                    : guard.status === 'gaveUp'
                      ? t('pulls.guard.gaveUp', { limit: GUARD_ATTEMPTS })
                      : t('pulls.guard.watching')}
              </span>
            )}
            <button
              className={`pull-guard ${guard ? 'active' : ''}`}
              aria-pressed={guard !== undefined}
              data-testid="pull-guard"
              title={t('pulls.guard.hint', { limit: GUARD_ATTEMPTS })}
              onClick={() => onGuard(guard === undefined)}
            >
              {t('pulls.guard.toggle')}
            </button>
          </>
        )}
      </div>
      <div className="pull-meta muted">
        <span>{t('pulls.by', { author: pull.author, branch: pull.branch, base: pull.base })}</span>
        {Number.isFinite(updated) && (
          <span>{t('pulls.updated', { age: duration(t, updated, now) })}</span>
        )}
        {counted.length > 0 && (
          <span>{t('pulls.pipeline.jobs', { passed, total: counted.length })}</span>
        )}
        {pull.comments > 0 && (
          <span>
            {pull.comments === 1
              ? t('pulls.comment')
              : t('pulls.comments', { count: pull.comments })}
          </span>
        )}
        {pull.reviewers.length > 0 && (
          <span>{t('pulls.reviewers', { names: pull.reviewers.join(', ') })}</span>
        )}
      </div>
      {failed.length > 0 && (
        <div className="pull-failed">
          <ul>
            {failed.map((job) => (
              <li key={job.name}>
                {job.url ? (
                  <a
                    href={job.url}
                    onClick={(e) => {
                      e.preventDefault();
                      openSite(job.url!);
                    }}
                  >
                    {job.name}
                  </a>
                ) : (
                  job.name
                )}
              </li>
            ))}
          </ul>
          <button
            className="primary"
            onClick={onFix}
            disabled={fixing}
            title={t('pulls.fixHint')}
            data-testid="pull-fix"
          >
            {fixing ? t('pulls.fixing') : t('pulls.fix')}
          </button>
        </div>
      )}
    </article>
  );
}
