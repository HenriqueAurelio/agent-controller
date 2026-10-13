import type { AgentProfileId } from '@shared/session';
import type { SignalPriorities } from '../sessions/SignalAggregator';
import type { TitleRules } from '../signals/title';

export type HookSupport = 'always' | 'needs-trust';

/** Everything the app knows about an agent, as data. Nothing else names a specific agent. */
export interface AgentProfile {
  id: AgentProfileId;
  displayName: string;
  /** Looked up on the PATH. */
  executable: string;
  baseArgs: string[];
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
  installHint: string;
}

const BRAILLE = '\\u2800-\\u28FF';

export const CLAUDE_CODE: AgentProfile = {
  id: 'claude-code',
  displayName: 'Claude Code',
  executable: 'claude',
  baseArgs: [],
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
  installHint: 'Instale com: npm install -g @anthropic-ai/claude-code',
};

export const CODEX: AgentProfile = {
  id: 'codex',
  displayName: 'Codex',
  executable: 'codex',
  baseArgs: [],
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
  installHint: 'Instale com: npm install -g @openai/codex',
};

export const PROFILES: Record<AgentProfileId, AgentProfile> = {
  'claude-code': CLAUDE_CODE,
  codex: CODEX,
};

export function getProfile(id: AgentProfileId): AgentProfile {
  return PROFILES[id];
}
