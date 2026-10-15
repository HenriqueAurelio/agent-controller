import { isFailure, stripAnsi, type ChecksRun } from '@shared/checks';
import { translate, type Language } from '@shared/i18n';

/** Lines of the output of each failed check that go to the agent: where the error usually is. */
export const REPORT_LINES = 60;

/**
 * What the agent is told when the checks failed: which ones, the command, and the end of what each
 * printed. Null when nothing failed.
 */
export function failureReport(run: ChecksRun, language: Language): string | null {
  const failed = run.results.filter((result) => isFailure(result.outcome));
  if (failed.length === 0) return null;
  const parts = [translate(language, 'checks.report.header')];
  for (const result of failed) {
    const reason =
      result.outcome === 'timedOut'
        ? translate(language, 'checks.report.timedOut')
        : result.outcome === 'error'
          ? translate(language, 'checks.report.notStarted')
          : translate(language, 'checks.report.exitCode', { code: result.exitCode ?? '?' });
    const lines = stripAnsi(result.output).trimEnd().split('\n');
    const tail = lines.slice(-REPORT_LINES).join('\n').trim();
    parts.push(
      [
        `$ ${result.command} (${reason})`,
        tail || translate(language, 'checks.report.noOutput'),
      ].join('\n'),
    );
  }
  return parts.join('\n\n');
}
