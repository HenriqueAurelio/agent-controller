import { spawn } from 'node:child_process';
import { UserError } from '@shared/i18n';
import {
  KNOWN_EDITORS,
  type EditorInfo,
  type ExternalEditorPrefs,
  type KnownEditorId,
} from '@shared/editor';
import { findOnPath } from '../agents/detect';
import { quotePosix, quotePowerShell } from '../agents/shellCommand';
import { isBatchFile, quoteWindowsArg } from '../pty/windowsArgs';

/** What to open: the folder of the session, and optionally one file of it (absolute) in a place. */
export interface EditorTarget {
  folder: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface EditorLaunch {
  file: string;
  args: string[];
  /** Windows only: the arguments are already a command line for cmd.exe and go through untouched. */
  verbatim?: boolean;
}

interface EditorProfile {
  id: KnownEditorId;
  displayName: string;
  /** Names looked for on the PATH, the first one found wins. */
  executables: string[];
  args(target: EditorTarget): string[];
}

/** `path:line:column`, the form every editor here takes. */
function position(target: EditorTarget): string | null {
  if (!target.file) return null;
  if (!target.line) return target.file;
  return `${target.file}:${target.line}${target.column ? `:${target.column}` : ''}`;
}

/** VS Code and the editors built on it: the folder, then `-g` to go to the file and line. */
const vscodeLike = (target: EditorTarget): string[] => {
  const spot = position(target);
  return spot ? [target.folder, '-g', spot] : [target.folder];
};

export const EDITOR_PROFILES: Record<KnownEditorId, EditorProfile> = {
  vscode: { id: 'vscode', displayName: 'VS Code', executables: ['code'], args: vscodeLike },
  cursor: { id: 'cursor', displayName: 'Cursor', executables: ['cursor'], args: vscodeLike },
  windsurf: {
    id: 'windsurf',
    displayName: 'Windsurf',
    executables: ['windsurf'],
    args: vscodeLike,
  },
  zed: {
    id: 'zed',
    displayName: 'Zed',
    // `zeditor` and `zed-editor` are the names the Linux packages use.
    executables: ['zed', 'zeditor', 'zed-editor'],
    args: (target) => {
      const spot = position(target);
      return spot ? [target.folder, spot] : [target.folder];
    },
  },
};

const lookup = (profile: EditorProfile, env: NodeJS.ProcessEnv): string | null => {
  for (const name of profile.executables) {
    const found = findOnPath(name, env);
    if (found) return found;
  }
  return null;
};

/** Which of the known editors are installed (on the PATH). */
export function detectEditors(env: NodeJS.ProcessEnv = process.env): EditorInfo[] {
  return KNOWN_EDITORS.map((id) => {
    const found = lookup(EDITOR_PROFILES[id], env);
    return found ? { id, found: true, path: found } : { id, found: false };
  });
}

/**
 * One argument inside a `cmd.exe` command line. Quoted whenever cmd would read something in it
 * (`&`, `|`, `(`...). Inside quotes only `%` still expands and cannot be escaped, so a path with
 * one is refused instead of being run as something else.
 */
export function quoteCmdArg(arg: string): string {
  if (arg.includes('%') || /[\r\n\0]/.test(arg)) {
    throw new UserError('error.editor.badPath', { path: arg });
  }
  return quoteWindowsArg(arg, /[\s"&|<>^(),;=!]/.test(arg));
}

/** The process that opens a known editor, given where it was found. */
export function editorLaunch(
  id: KnownEditorId,
  target: EditorTarget,
  {
    platform = process.platform,
    env = process.env,
  }: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): EditorLaunch {
  const profile = EDITOR_PROFILES[id];
  const executable = lookup(profile, env);
  if (!executable) {
    throw new UserError('error.editor.notFound', { name: profile.displayName });
  }
  const args = profile.args(target);
  // `code` and `cursor` are .cmd shims, which only cmd.exe starts. Never a line built from a
  // path without quoting it: see `quoteCmdArg`.
  if (platform === 'win32' && isBatchFile(executable)) {
    const line = [executable, ...args].map(quoteCmdArg).join(' ');
    return {
      file: env.ComSpec || process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      verbatim: true,
    };
  }
  return { file: executable, args };
}

/**
 * The command of the user ("other"), with {pasta}, {arquivo}, {linha} and {coluna} replaced by
 * values quoted for the shell it runs in, so a path never becomes more than one argument. What is
 * not known (no file open) is an empty argument.
 */
export function customLaunch(
  command: string,
  target: EditorTarget,
  {
    platform = process.platform,
    env = process.env,
  }: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): EditorLaunch {
  if (!command.trim()) throw new UserError('error.editor.noCommand');
  const quote = platform === 'win32' ? quotePowerShell : (value: string) => quotePosix(value);
  const values: Record<string, string> = {
    pasta: target.folder,
    arquivo: target.file ?? '',
    linha: target.line ? String(target.line) : '',
    coluna: target.column ? String(target.column) : '',
  };
  const line = command.replace(/\{(pasta|arquivo|linha|coluna)\}/g, (_all, name: string) =>
    quote(values[name] ?? ''),
  );
  if (platform === 'win32') {
    const shell = findOnPath('pwsh', env) ?? 'powershell.exe';
    const encoded = Buffer.from(line, 'utf16le').toString('base64');
    return { file: shell, args: ['-NoLogo', '-NonInteractive', '-EncodedCommand', encoded] };
  }
  return { file: '/bin/sh', args: ['-c', line] };
}

/** The launch for what the user picked. */
export function launchFor(
  prefs: ExternalEditorPrefs,
  target: EditorTarget,
  options?: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv },
): EditorLaunch {
  if (!prefs.editor) throw new UserError('error.editor.none');
  return prefs.editor === 'other'
    ? customLaunch(prefs.command, target, options)
    : editorLaunch(prefs.editor, target, options);
}

/**
 * Starts the editor and lets go of it: it outlives the app and nothing waits for it. Resolves once
 * the process exists, and fails when it could not even start.
 */
export function startEditor(launch: EditorLaunch, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(launch.file, launch.args, {
      cwd,
      // On Windows a child outlives its parent anyway, and PowerShell does not run at all when
      // started detached (no console); elsewhere detaching keeps it out of the app's process group.
      detached: process.platform !== 'win32',
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: launch.verbatim === true,
    });
    child.once('error', (err) =>
      reject(new UserError('error.editor.failed', { reason: err.message })),
    );
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
