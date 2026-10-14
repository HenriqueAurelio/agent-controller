import type { AdapterHost, AgentAdapter } from './adapter';
import { ClaudeAdapter } from './claudeAdapter';
import { CodexAdapter } from './codexAdapter';
import type { AgentProfile } from './profiles';

export function createAdapter(profile: AgentProfile, host: AdapterHost): AgentAdapter {
  switch (profile.id) {
    case 'claude-code':
      return new ClaudeAdapter(profile, host);
    case 'codex':
      return new CodexAdapter(profile, host);
  }
}

export type { AdapterHost, AgentAdapter } from './adapter';
export * from './profiles';
export * from './commandLine';
export * from './detect';
