import type { AgentProfileId } from '@shared/session';
import type { SignalPriorities } from '../sessions/SignalAggregator';
import type { TitleRules } from '../signals/title';
import type { PermissionMenu } from './permission';

export type HookSupport = 'always' | 'needs-trust';

/** Everything the app knows about an agent, as data. Nothing else names a specific agent. */
export interface AgentProfile {
  id: AgentProfileId;
  displayName: string;
  /** Looked up on the PATH. */
  executable: string;
  baseArgs: string[];
  /** Added when the session must only read (a reviewer). Absent: the agent has no such mode. */
  readOnlyArgs?: string[];
  env: Record<string, string>;
  signals: {
    hooks: HookSupport;
    /** Hook events the app subscribes to. */
    hookEvents: string[];
    notify: boolean;
    title: TitleRules;
  };
  priorities: SignalPriorities;
  /** How long the title must stay idle after working before it counts as the end of the turn. */
  idleSettleMs: number;
  versionArgs: string[];
  minVersion: string;
  lastTestedVersion: string;
  /** The command that installs the agent, offered when it is not found. */
  installCommand: string;
  /**
   * The agent's permission menu, answered from outside the terminal (ADR 0020). Absent: requests
   * are only answered in the terminal.
   */
  permission?: PermissionMenu;
}

const BRAILLE = '\\u2800-\\u28FF';

export const CLAUDE_CODE: AgentProfile = {
  id: 'claude-code',
  displayName: 'Claude Code',
  executable: 'claude',
  baseArgs: [],
  // Plan mode: the agent reads and proposes, and asks before anything that writes.
  readOnlyArgs: ['--permission-mode', 'plan'],
  env: {},
  signals: {
    hooks: 'always',
    hookEvents: ['SessionStart', 'Stop', 'PermissionRequest', 'Notification'],
    notify: false,
    // `✳` means stopped *or* asking for permission: the title only tells working from not.
    title: { workingIndicator: new RegExp(`[◐◑◒◓${BRAILLE}]`, 'u') },
  },
  // Hooks are the main signal and are enough; the title only fills in "working or not".
  priorities: { processo: 9, hook: 3, notify: 2, titulo: 1, silencio: 0 },
  // A cancelled turn (Esc) fires no Stop hook: give the hook time to arrive before trusting
  // the title alone.
  idleSettleMs: 2000,
  versionArgs: ['--version'],
  minVersion: '2.1.0',
  lastTestedVersion: '2.1.296',
  installCommand: 'npm install -g @anthropic-ai/claude-code',
  // "Do you want to proceed?" / "Do you want to make this edit to x?", then numbered options; a
  // number picks its option at once. Esc is "No" whether the menu has two options or three.
  permission: {
    menu: /Do you want to\b[\s\S]*?\?[\s\S]*\b1\.\s+Yes\b/,
    always: /\b2\.\s+Yes, (?:and don['’]t ask again|allow all)/i,
    keys: { allow: '1', allowAlways: '2', deny: '\x1b' },
  },
};

export const CODEX: AgentProfile = {
  id: 'codex',
  displayName: 'Codex',
  executable: 'codex',
  baseArgs: [],
  readOnlyArgs: ['--sandbox', 'read-only'],
  env: {},
  signals: {
    hooks: 'needs-trust',
    hookEvents: ['SessionStart', 'PermissionRequest'],
    notify: true,
    title: {
      workingIndicator: new RegExp(`[${BRAILLE}]`, 'u'),
      waiting: /Action Required/i,
    },
  },
  // Decision 1.1: the title is the main signal, because it works without the user doing
  // anything; trusted hooks confirm it. Swap `titulo` and `hook` to invert.
  priorities: { processo: 9, titulo: 3, hook: 2, notify: 2, silencio: 0 },
  idleSettleMs: 700,
  versionArgs: ['--version'],
  minVersion: '0.158.0',
  lastTestedVersion: '0.158.0',
  installCommand: 'npm install -g @openai/codex',
  // "Would you like to run the following command?", with a letter for each option. Requests only
  // reach the app through the hooks, once they are trusted.
  permission: {
    menu: /Would you like to\b[\s\S]*\bYes, proceed\b/i,
    always: /\bYes, and don['’]t ask again\b/i,
    keys: { allow: 'y', allowAlways: 'a', deny: '\x1b' },
  },
};

export const PROFILES: Record<AgentProfileId, AgentProfile> = {
  'claude-code': CLAUDE_CODE,
  codex: CODEX,
};

export function getProfile(id: AgentProfileId): AgentProfile {
  return PROFILES[id];
}
