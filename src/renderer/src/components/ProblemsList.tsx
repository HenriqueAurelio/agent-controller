import { useEffect, useMemo, useState } from 'react';
import { problemPlace, type Problem } from '@shared/checks';
import { useT } from '../lib/i18n';
import type { ProblemsState } from '../lib/useProblems';
import { LinkedOutput } from './LinkedOutput';

interface Props {
  sessionId: string;
  state: ProblemsState;
  /** The agent is working again, so the list may be about code that is gone. */
  stale: boolean;
  /** The problem whose file is open in the editor. */
  current: Problem | null;
  onOpen(problem: Problem): void;
  onSend(problems: Problem[]): void;
  onRunChecks(): void;
}

const keyOf = (p: Problem) => `${p.checkId}\0${p.file}\0${p.line}\0${p.column ?? ''}\0${p.message}`;

interface FileGroup {
  file: string;
  problems: Problem[];
}

function groupByFile(problems: Problem[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const problem of problems) {
    let group = groups.get(problem.file);
    if (!group) groups.set(problem.file, (group = { file: problem.file, problems: [] }));
    group.problems.push(problem);
  }
  return [...groups.values()];
}

/** The errors and warnings of the checks, by file: open one, or send some of them to the agent. */
export function ProblemsList({
  sessionId,
  state,
  stale,
  current,
  onOpen,
  onSend,
  onRunChecks,
}: Props) {
  const t = useT();
  const { problems } = state;
  const groups = useMemo(() => groupByFile(problems), [problems]);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  // A new run is a new list: what was ticked belonged to the old one.
  useEffect(() => setMarked(new Set()), [problems]);

  const picked = problems.filter((p) => marked.has(keyOf(p)));
  const toggle = (problem: Problem) =>
    setMarked((set) => {
      const next = new Set(set);
      const key = keyOf(problem);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const dim = stale || state.running;

  return (
    <div
      className="changes-list problems-list"
      data-testid="problems-list"
      data-stale={dim}
      aria-label={t('problems.title')}
    >
      <div className="problems-toolbar">
        {problems.length > 0 && (
          <>
            <button
              className="primary"
              data-testid="problems-send-marked"
              disabled={picked.length === 0}
              title={t('problems.sendHint')}
              onClick={() => onSend(picked)}
            >
              {t('problems.sendMarked', { count: picked.length })}
            </button>
            <button
              data-testid="problems-send-all"
              title={t('problems.sendHint')}
              onClick={() => onSend(problems)}
            >
              {t('problems.sendAll')}
            </button>
            <button
              onClick={() =>
                setMarked(
                  picked.length === problems.length ? new Set() : new Set(problems.map(keyOf)),
                )
              }
            >
              {picked.length === problems.length ? t('problems.clearMarks') : t('problems.markAll')}
            </button>
          </>
        )}
        <span className="spacer" />
        <button
          data-testid="problems-run"
          disabled={state.running || !state.hasChecks}
          onClick={onRunChecks}
        >
          {state.running ? t('problems.running') : t('problems.runChecks')}
        </button>
      </div>

      {stale && (
        <p className="problems-note" role="status" data-testid="problems-stale">
          {t('problems.stale')}
        </p>
      )}

      <div className={dim ? 'problems-groups dim' : 'problems-groups'}>
        {problems.length === 0 && state.unread.length === 0 && (
          <p className="problems-note muted">
            {!state.hasChecks
              ? t('problems.noChecks')
              : state.ran
                ? t('problems.none')
                : t('problems.noRun')}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.file} className="problems-file" data-testid="problems-file">
            <h3 title={group.file}>
              <span className="problems-file-name">{group.file}</span>
              <span className="count">{group.problems.length}</span>
            </h3>
            <ul>
              {group.problems.map((problem) => {
                const place = problemPlace(problem);
                return (
                  <li
                    key={keyOf(problem)}
                    className={`problem-row severity-${problem.severity} ${current && keyOf(current) === keyOf(problem) ? 'current' : ''}`}
                    data-testid="problem-row"
                    data-severity={problem.severity}
                  >
                    <input
                      type="checkbox"
                      data-testid="problem-mark"
                      aria-label={t('problems.mark', { place })}
                      checked={marked.has(keyOf(problem))}
                      onChange={() => toggle(problem)}
                    />
                    <button
                      className="problem-open"
                      data-testid="problem-open"
                      title={`${t('problems.openIn', { place })}\n${problem.message}`}
                      onClick={() => onOpen(problem)}
                    >
                      <span
                        className={`problem-icon severity-${problem.severity}`}
                        role="img"
                        aria-label={t(`problems.${problem.severity}`)}
                      >
                        {problem.severity === 'error' ? '✗' : '⚠'}
                      </span>
                      <span className="problem-message">{problem.message}</span>
                      <span className="problem-where">
                        {problem.line}
                        {problem.column ? `:${problem.column}` : ''}
                      </span>
                      <span className="problem-source muted">{problem.source}</span>
                    </button>
                    <span className="problem-actions">
                      <button
                        className="icon-button"
                        data-testid="problem-send"
                        title={t('problems.sendOne')}
                        aria-label={t('problems.sendOne')}
                        onClick={() => onSend([problem])}
                      >
                        ➤
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {state.more > 0 && (
          <p className="problems-note muted" data-testid="problems-more">
            {t('problems.more', { count: state.more })}
          </p>
        )}
        {state.unread.map((result) => (
          <details key={result.id} className="problems-unread" open>
            <summary>{t('problems.rawOutput', { label: result.label })}</summary>
            <pre className="checks-output">
              {result.output.trim() ? (
                <LinkedOutput sessionId={sessionId} text={result.output.trim()} />
              ) : (
                t('checks.noOutput')
              )}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}
