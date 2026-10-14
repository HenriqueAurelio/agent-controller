import type { AgentProfileId } from './session';

export type AgentAvailabilityStatus = 'ok' | 'missing' | 'outdated' | 'newer-than-tested';

export interface AgentAvailability {
  profile: AgentProfileId;
  displayName: string;
  /** The name the agent is looked up by on the PATH: what runs when no command is asked for. */
  executable: string;
  status: AgentAvailabilityStatus;
  /** Only `missing` blocks the creation of a session. */
  usable: boolean;
  path?: string;
  version?: string;
  minVersion: string;
  lastTestedVersion: string;
  /** The command that installs the agent, shown when it is `missing`. */
  installCommand: string;
}

export const AGENT_COMMAND_LIMIT = 500;

const hasControlCharacter = (text: string) =>
  [...text].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f);

/**
 * A command the user asked for in place of the agent's own. One line, as it would be typed in a
 * shell; anything else is no command.
 */
export function sanitizeAgentCommand(value: unknown): string {
  if (typeof value !== 'string') return '';
  const command = value.trim();
  return command.length > AGENT_COMMAND_LIMIT || hasControlCharacter(command) ? '' : command;
}

export type AgentCommands = Record<AgentProfileId, string>;

export const NO_AGENT_COMMANDS: AgentCommands = { 'claude-code': '', codex: '' };

export function sanitizeAgentCommands(value: unknown): AgentCommands {
  const given = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    'claude-code': sanitizeAgentCommand(given['claude-code']),
    codex: sanitizeAgentCommand(given.codex),
  };
}
