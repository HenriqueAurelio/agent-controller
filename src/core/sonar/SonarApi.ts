// The Web API of SonarQube and SonarCloud, with the token of a group: whether the connection works,
// how the processing of a report went, the quality gate and the open issues of a branch.
import type { Problem } from '@shared/checks';
import { SONAR_CHECK_ID, SONAR_ISSUES_LIMIT, type SonarConfig } from '@shared/sonar';

type Json = Record<string, unknown>;
type Fetch = typeof fetch;

const obj = (value: unknown): Json => (value && typeof value === 'object' ? (value as Json) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export class SonarApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'SonarApiError';
  }
}

/** The severities that block: the rest is a warning in the list. */
const ERRORS = new Set(['BLOCKER', 'CRITICAL', 'MAJOR', 'HIGH']);

/**
 * An issue of the API as a problem of the list. `component` is `projectKey:path/of/file`; the
 * path is relative to the root of the project, which is the folder the scanner ran in.
 */
export function issueProblem(issue: unknown, projectKey: string): Problem | null {
  const i = obj(issue);
  const component = text(i.component);
  // Only an issue of a file of this project has a place in the list.
  const file = component.startsWith(`${projectKey}:`) ? component.slice(projectKey.length + 1) : '';
  if (!file) return null;
  const severity =
    text(i.severity) || text(obj((i.impacts as unknown[] | undefined)?.[0]).severity);
  return {
    file,
    line: typeof i.line === 'number' && i.line > 0 ? i.line : 1,
    severity: ERRORS.has(severity) ? 'error' : 'warning',
    message: `${text(i.message)} (${text(i.rule)})`,
    source: 'Sonar',
    checkId: SONAR_CHECK_ID,
  };
}

export class SonarApi {
  private readonly fetch: Fetch;

  constructor(
    private readonly config: Pick<SonarConfig, 'url' | 'projectKey' | 'organization'>,
    private readonly token: string,
    options: { fetch?: Fetch } = {},
  ) {
    this.fetch = options.fetch ?? fetch;
  }

  /** The token is valid and the project exists and is visible to it. */
  async test(): Promise<void> {
    const auth = obj(await this.get('/api/authentication/validate'));
    if (auth.valid !== true) throw new SonarApiError('token', 401);
    await this.get(`/api/components/show?component=${encodeURIComponent(this.config.projectKey)}`);
  }

  /** How the processing of a report went: `SUCCESS`, `FAILED`, `CANCELED`, or still going. */
  async task(id: string): Promise<{ status: string; error: string }> {
    const task = obj(obj(await this.get(`/api/ce/task?id=${encodeURIComponent(id)}`)).task);
    return { status: text(task.status), error: text(task.errorMessage) };
  }

  async gate(branch: string | null): Promise<'OK' | 'WARN' | 'ERROR' | null> {
    const status = obj(
      obj(
        await this.get(
          `/api/qualitygates/project_status?projectKey=${encodeURIComponent(this.config.projectKey)}${branchParam(branch)}`,
        ),
      ).projectStatus,
    ).status;
    return status === 'OK' || status === 'WARN' || status === 'ERROR' ? status : null;
  }

  /** The open issues of the branch, at most the limit; `total` counts them all. */
  async issues(branch: string | null): Promise<{ problems: Problem[]; total: number }> {
    const body = obj(
      await this.get(
        `/api/issues/search?componentKeys=${encodeURIComponent(this.config.projectKey)}` +
          `&resolved=false&ps=${SONAR_ISSUES_LIMIT}${branchParam(branch)}`,
      ),
    );
    const list = Array.isArray(body.issues) ? body.issues : [];
    const problems = list
      .map((issue) => issueProblem(issue, this.config.projectKey))
      .filter((p): p is Problem => p !== null);
    const total =
      typeof obj(body.paging).total === 'number'
        ? (obj(body.paging).total as number)
        : typeof body.total === 'number'
          ? body.total
          : problems.length;
    return { problems, total };
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(`${this.config.url}${path}`, {
        headers: {
          // A token as the user name, with no password: what every version of the API takes.
          authorization: `Basic ${Buffer.from(`${this.token}:`).toString('base64')}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new SonarApiError(err instanceof Error ? err.message : String(err));
    }
    const body = await response.text();
    if (!response.ok) {
      let message = '';
      try {
        message =
          (obj(JSON.parse(body)).errors as Json[] | undefined)
            ?.map((e) => text(e.msg))
            .join('; ') ?? '';
      } catch {
        // Not JSON: the status says it.
      }
      throw new SonarApiError(
        `Sonar ${response.status}${message ? `: ${message}` : ''}`,
        response.status,
      );
    }
    return body ? (JSON.parse(body) as unknown) : null;
  }
}

const branchParam = (branch: string | null) =>
  branch ? `&branch=${encodeURIComponent(branch)}` : '';
