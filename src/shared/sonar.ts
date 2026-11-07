// Sonar as one more validation of the code (docs/planos/sonar-por-grupo-e-worktree.md): set up once
// for a group, the repository its sessions work on; analysed and reported per session, since each
// session may be on a branch of its own.
import type { Problem } from './checks';

export type SonarProvider = 'sonarqube' | 'sonarcloud';

/** What is saved for a group. The token is never here: it goes to the system's vault. */
export interface SonarConfig {
  provider: SonarProvider;
  /** The server; for SonarCloud, always `https://sonarcloud.io`. */
  url: string;
  projectKey: string;
  /** SonarCloud only. */
  organization: string;
  /** The command that runs the scanner, in the user's shell; `sonar-scanner` by default. */
  scanner: string;
  enabled: boolean;
  /**
   * Analyse each session as its own branch (`sonar.branch.name`). SonarCloud and the paid editions
   * of SonarQube have it; the Community Edition only knows the main branch.
   */
  branches: boolean;
  /** Analyse each session of the group when its agent ends a turn. */
  onTurnEnd: boolean;
  /**
   * Analyse a copy before its pull request is opened, and hold the opening when the quality gate
   * fails. The moment that counts: what goes to the service, not every turn on the way.
   */
  beforePull: boolean;
}

export const SONARCLOUD_URL = 'https://sonarcloud.io';
export const DEFAULT_SONARQUBE_URL = 'http://localhost:9000';
export const DEFAULT_SCANNER = 'sonar-scanner';
export const SONAR_TOKEN_LIMIT = 500;

/**
 * `queued`: waiting for another analysis of the repository; `running`: the scanner; `processing`:
 * the server is reading the report; `passed`/`failed`: the quality gate said so; `error`: the
 * analysis did not finish; `cancelled`: the agent went back to work.
 */
export type SonarStatus =
  'queued' | 'running' | 'processing' | 'passed' | 'failed' | 'error' | 'cancelled';

export interface SonarRun {
  status: SonarStatus;
  /** Epoch milliseconds. */
  startedAt: number;
  finishedAt?: number;
  /** The branch analysed; null when the session is not on one. */
  branch: string | null;
  /**
   * The commit checked out when the analysis started: a result is about this code, and a pull
   * request or a push of another commit needs another analysis.
   */
  commit?: string;
  /** The quality gate of the analysis, when the server has one. */
  gate?: 'OK' | 'WARN' | 'ERROR' | null;
  /** The open issues of this session's code, as the problems list shows them. */
  problems: Problem[];
  /** Issues found beyond the ones kept. */
  more: number;
  /** For `error`, as the user reads it. */
  error?: string;
}

/** What the group dialog shows: the saved setup, whether a token is kept, and if it can be. */
export interface SonarGroupInfo {
  config: SonarConfig | null;
  hasToken: boolean;
  /** The system can keep a secret (DPAPI, Keychain, libsecret); without it no token is saved. */
  secureStorage: boolean;
}

/** The answer of "Test connection". */
export interface SonarTestResult {
  ok: boolean;
  /** What went wrong, as the user reads it. */
  error?: string;
}

/** The issues kept per analysis; the rest are only counted. */
export const SONAR_ISSUES_LIMIT = 500;
/** The `checkId` of the problems that came from Sonar. */
export const SONAR_CHECK_ID = 'sonar';

const KEY = /^[\w.:-]{1,400}$/;
const ORG = /^[\w.-]{0,255}$/;

/** A setup that can be used, or null. Fills the URL of SonarCloud and the default scanner. */
export function sanitizeSonarConfig(value: unknown): SonarConfig | null {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const provider: SonarProvider = v.provider === 'sonarcloud' ? 'sonarcloud' : 'sonarqube';
  const projectKey = typeof v.projectKey === 'string' ? v.projectKey.trim() : '';
  if (!KEY.test(projectKey)) return null;
  const organization = typeof v.organization === 'string' ? v.organization.trim() : '';
  if (!ORG.test(organization) || (provider === 'sonarcloud' && !organization)) return null;
  let url = provider === 'sonarcloud' ? SONARCLOUD_URL : '';
  if (provider === 'sonarqube') {
    const given = typeof v.url === 'string' ? v.url.trim().replace(/\/+$/, '') : '';
    try {
      const parsed = new URL(given);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      url = given;
    } catch {
      return null;
    }
  }
  const scanner =
    typeof v.scanner === 'string' && v.scanner.trim() && !/[\r\n]/.test(v.scanner)
      ? v.scanner.trim().slice(0, 1000)
      : DEFAULT_SCANNER;
  return {
    provider,
    url,
    projectKey,
    organization: provider === 'sonarcloud' ? organization : '',
    scanner,
    enabled: v.enabled !== false,
    branches: v.branches !== false,
    onTurnEnd: v.onTurnEnd === true,
    beforePull: v.beforePull !== false,
  };
}

/** The summary of a group's header: how many sessions passed and how many have problems. */
export function sonarSummary(runs: readonly (SonarRun | undefined)[]): {
  passed: number;
  failed: number;
  running: number;
} {
  let passed = 0;
  let failed = 0;
  let running = 0;
  for (const run of runs) {
    if (!run) continue;
    if (run.status === 'passed') passed++;
    else if (run.status === 'failed' || run.status === 'error') failed++;
    else if (run.status === 'queued' || run.status === 'running' || run.status === 'processing')
      running++;
  }
  return { passed, failed, running };
}
