// Variables that belong to the app itself (Electron, Vite, AppImage, a parent agent) and must not
// leak into the agent started inside a session.
const INTERNAL_PREFIXES = ['ELECTRON_', 'VITE_', 'CHROME_', 'AGENT_CONTROLLER_', 'AGENTCTL_'];
const INTERNAL_NAMES = new Set([
  'NODE_ENV',
  'NODE_OPTIONS',
  'NODE_CHANNEL_FD',
  'NODE_CHANNEL_SERIALIZATION_MODE',
  'ORIGINAL_XDG_CURRENT_DESKTOP',
  'GOOGLE_API_KEY',
  'APPIMAGE',
  'APPDIR',
  'ARGV0',
  'OWD',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
]);

export function isInternalVariable(name: string): boolean {
  const upper = name.toUpperCase();
  return INTERNAL_NAMES.has(upper) || INTERNAL_PREFIXES.some((p) => upper.startsWith(p));
}

/** Environment for a child process: the parent's, minus the app's own variables, plus `extra`. */
export function buildChildEnv(
  parent: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || isInternalVariable(name)) continue;
    env[name] = value;
  }
  if (process.platform !== 'win32') {
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
  }
  return { ...env, ...extra };
}
