// How the app behaves as an installed application on Linux: it lets go of the terminal that
// started it, and an AppImage puts itself in the menu of applications.

/** Set on the copy that already let go of the terminal, so it does not do it again. */
export const DETACHED_ENV = 'AURELIUM_DETACHED';

/** Keeps the app attached to the terminal, with its output there: for looking into a problem. */
export const FOREGROUND_FLAG = '--foreground';

export interface StartContext {
  platform: NodeJS.Platform;
  /** Whether it runs as the packaged app, not from `npm run dev`. */
  packaged: boolean;
  /** Whether it was started from a terminal. */
  stdoutIsTTY: boolean;
  env: NodeJS.ProcessEnv;
  argv: string[];
  execPath: string;
}

/**
 * What to start in place of this process so that the app outlives the terminal it was started
 * from, or null to go on here. Closing that terminal would otherwise take the app down with it,
 * and every session with it.
 */
export function detachTarget(context: StartContext): { file: string; args: string[] } | null {
  const { platform, packaged, stdoutIsTTY, env, argv } = context;
  if (platform !== 'linux' || !packaged || !stdoutIsTTY) return null;
  if (env[DETACHED_ENV] === '1' || env.AGENT_CONTROLLER_TEST_SHELL === '1') return null;
  if (argv.includes(FOREGROUND_FLAG)) return null;
  // An AppImage runs from a mount that goes away with the process that made it: the copy has to
  // be started from the AppImage file, not from the program inside it.
  const file = env.APPIMAGE || context.execPath;
  return { file, args: argv.slice(1) };
}

/** A value of the Exec key: quoted as the desktop entry spec asks. */
export function execArgument(value: string): string {
  return `"${value.replace(/(["`$\\])/g, '\\$1')}"`;
}

/** A string value of a desktop entry: a newline must not start a key of its own. */
function entryString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export interface DesktopEntryInput {
  name: string;
  comment: string;
  /** The program the menu starts. */
  exec: string;
  icon: string;
  /** Has to match the window's app id, or the dock does not tie the window to the entry. */
  wmClass: string;
}

/** The entry of the app in the menu of applications (freedesktop desktop entry). */
export function desktopEntry(input: DesktopEntryInput): string {
  return [
    '[Desktop Entry]',
    `Name=${entryString(input.name)}`,
    `Comment=${entryString(input.comment)}`,
    `Exec=${execArgument(input.exec)} %U`,
    // A moved or deleted AppImage hides the entry instead of leaving one that does nothing.
    `TryExec=${input.exec}`,
    'Terminal=false',
    'Type=Application',
    `Icon=${entryString(input.icon)}`,
    `StartupWMClass=${entryString(input.wmClass)}`,
    'Categories=Development;',
    '',
  ].join('\n');
}
