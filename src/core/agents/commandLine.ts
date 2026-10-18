import fs from 'node:fs';
import path from 'node:path';
import type { AgentctlInstall } from '../signals/agentctlInstall';
import type { AgentProfile } from './profiles';

export interface LaunchContext {
  agentctl: AgentctlInstall;
  /** Where the app keeps the files it generates for the agents (its own data directory). */
  dataDirectory: string;
  /** Endpoint of the hook server. */
  socketPath: string;
  /** Codex only: pass the optional hooks. */
  codexHooks?: boolean;
  /** Resolved executable; defaults to the profile's name, looked up on the PATH. */
  executablePath?: string;
}

export interface LaunchCommand {
  file: string;
  args: string[];
  env: Record<string, string>;
}

/** A TOML literal string: no escapes, so Windows paths go through untouched. */
function tomlString(value: string): string {
  if (!value.includes("'") && !/[\r\n]/.test(value)) return `'${value}'`;
  return JSON.stringify(value);
}

export const CLAUDE_HOOK_SOURCE = 'claude-hook';
export const CODEX_HOOK_SOURCE = 'codex-hook';
export const CODEX_NOTIFY_SOURCE = 'codex-notify';

export function claudeSettings(profile: AgentProfile, agentctl: AgentctlInstall): object {
  const hooks: Record<string, unknown> = {};
  for (const event of profile.signals.hookEvents) {
    hooks[event] = [
      {
        hooks: [
          { type: 'command', command: `${agentctl.command} ${CLAUDE_HOOK_SOURCE}`, timeout: 5 },
        ],
      },
    ];
  }
  return { hooks };
}

/** Writes the `--settings` file. It lives in the app's data directory, never in the user's config. */
export function writeClaudeSettings(
  profile: AgentProfile,
  agentctl: AgentctlInstall,
  dataDirectory: string,
): string {
  const file = path.join(dataDirectory, 'claude-settings.json');
  const content = JSON.stringify(claudeSettings(profile, agentctl), null, 2);
  fs.mkdirSync(dataDirectory, { recursive: true });
  let current: string | null = null;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    // First run.
  }
  if (current !== content) fs.writeFileSync(file, content, 'utf8');
  return file;
}

export function codexConfigArgs(
  profile: AgentProfile,
  agentctl: AgentctlInstall,
  withHooks: boolean,
): string[] {
  const args: string[] = [];
  if (profile.signals.notify) {
    const program = [...agentctl.notify, CODEX_NOTIFY_SOURCE].map(tomlString).join(',');
    args.push('-c', `notify=[${program}]`);
  }
  if (withHooks) {
    // The command text is the same in every session: Codex hashes it to remember the trust.
    const command = tomlString(`${agentctl.command} ${CODEX_HOOK_SOURCE}`);
    for (const event of profile.signals.hookEvents) {
      args.push('-c', `hooks.${event}=[{hooks=[{type='command',command=${command}}]}]`);
    }
  }
  return args;
}

/** The final command line for a session. What identifies the session is only the environment. */
export function buildLaunchCommand(
  profile: AgentProfile,
  session: { id: string; readOnly?: boolean; model?: string; reasoning?: string },
  context: LaunchContext,
): LaunchCommand {
  const args = [...profile.baseArgs];
  if (session.readOnly && profile.readOnlyArgs) args.push(...profile.readOnlyArgs);
  if (profile.id === 'claude-code') {
    if (session.model) args.push('--model', session.model);
    args.push('--settings', writeClaudeSettings(profile, context.agentctl, context.dataDirectory));
  } else if (profile.id === 'codex') {
    if (session.model) args.push('--model', session.model);
    if (session.reasoning)
      args.push('--config', `model_reasoning_effort=${tomlString(session.reasoning)}`);
    args.push(...codexConfigArgs(profile, context.agentctl, context.codexHooks !== false));
  }
  return {
    file: context.executablePath ?? profile.executable,
    args,
    env: {
      ...profile.env,
      ...(profile.id === 'claude-code' && session.reasoning
        ? { CLAUDE_CODE_EFFORT_LEVEL: session.reasoning }
        : {}),
      AGENTCTL_SESSION_ID: session.id,
      AGENTCTL_SOCKET: context.socketPath,
    },
  };
}
