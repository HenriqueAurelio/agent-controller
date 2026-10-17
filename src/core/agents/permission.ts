import { cutMiddle, PERMISSION_CHOICES, type PermissionChoice } from '@shared/session';
import type { AgentProfile } from './profiles';

/** The agent's own permission menu, as data: how to see it on the screen and how to answer it. */
export interface PermissionMenu {
  /** On the screen while the menu is open. */
  menu: RegExp;
  /** On the screen when the menu offers "don't ask again" for this request. */
  always?: RegExp;
  /** What each answer types, as if the user pressed it. */
  keys: { allow: string; allowAlways?: string; deny: string };
}

/** Fields of the input of a tool that say what it acts on, in order of preference. */
const TARGET_FIELDS = ['command', 'file_path', 'notebook_path', 'path', 'url', 'pattern', 'query'];

/** MCP tools come as `mcp__<server>__<tool>`. */
const MCP_TOOL = /^mcp__(.+?)__(.+)$/;

/**
 * What a request is for, from the name of the tool and its input as the hook gave them: the
 * command, the file, the MCP tool. The target is always cut to fit.
 */
export function describeRequest(
  toolName: unknown,
  toolInput: unknown,
): { tool: string; target: string } {
  const name = typeof toolName === 'string' ? toolName.trim() : '';
  const mcp = MCP_TOOL.exec(name);
  if (mcp) return { tool: 'MCP', target: cutMiddle(`${mcp[1]} › ${mcp[2]}`) };
  const input = (toolInput && typeof toolInput === 'object' ? toolInput : {}) as Record<
    string,
    unknown
  >;
  for (const field of TARGET_FIELDS) {
    const value = input[field];
    // Codex gives a command as its argv.
    const text = Array.isArray(value)
      ? value.filter((part) => typeof part === 'string').join(' ')
      : typeof value === 'string'
        ? value
        : '';
    if (text.trim()) return { tool: name, target: cutMiddle(text) };
  }
  return { tool: name, target: '' };
}

/** Every answer the profile knows how to type. */
export function profileChoices(profile: AgentProfile): PermissionChoice[] {
  const keys = profile.permission?.keys;
  if (!keys) return [];
  return PERMISSION_CHOICES.filter((choice) => keys[choice] !== undefined);
}

/**
 * What the menu on the screen offers right now, or null when no menu of the agent is there: the
 * agent moved on, or asked something else.
 */
export function menuChoices(profile: AgentProfile, screen: string): PermissionChoice[] | null {
  const permission = profile.permission;
  if (!permission || !permission.menu.test(screen)) return null;
  return profileChoices(profile).filter(
    (choice) => choice !== 'allowAlways' || (permission.always?.test(screen) ?? false),
  );
}

export function permissionKeys(profile: AgentProfile, choice: PermissionChoice): string | null {
  return profile.permission?.keys[choice] ?? null;
}
