import type { LaunchCommand } from './commandLine';
import { findOnPath } from './detect';

/** A literal for a POSIX shell: nothing inside single quotes is special. */
export function quotePosix(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** A literal for PowerShell: inside single quotes only the quote itself is doubled. */
export function quotePowerShell(arg: string): string {
  return `'${arg.replaceAll("'", "''")}'`;
}

/**
 * What PowerShell runs: the command with the arguments of the app after it, leaving with the
 * exit code of the agent. A function reports no failure of its own, hence `$LASTEXITCODE`.
 */
export function powerShellScript(command: string, args: string[]): string {
  return [
    '$global:LASTEXITCODE = 0',
    [command, ...args.map(quotePowerShell)].join(' '),
    'if (-not $? -and -not $LASTEXITCODE) { exit 1 }',
    'exit $LASTEXITCODE',
  ].join('\n');
}

export interface ShellOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/**
 * Runs a command of the user in place of the agent's executable, through their own shell: an
 * alias or a function only exists there. The shell starts as it does for the user (interactive
 * on POSIX, with the profile on Windows), and the arguments and environment of the app go along,
 * so the signals work whenever the command hands its arguments on to the agent.
 */
export function wrapInShell(
  launch: LaunchCommand,
  command: string,
  { platform = process.platform, env = process.env }: ShellOptions = {},
): LaunchCommand {
  if (platform === 'win32') {
    const shell = findOnPath('pwsh', env) ?? 'powershell.exe';
    // Encoded, the script crosses the command line of Windows with no quoting to get wrong.
    const encoded = Buffer.from(powerShellScript(command, launch.args), 'utf16le').toString(
      'base64',
    );
    return { ...launch, file: shell, args: ['-NoLogo', '-EncodedCommand', encoded] };
  }
  const line = [command, ...launch.args.map(quotePosix)].join(' ');
  return { ...launch, file: env.SHELL || '/bin/bash', args: ['-i', '-c', line] };
}

/**
 * The same, for a process read through pipes instead of shown in a terminal. Given a script by
 * `-EncodedCommand`, PowerShell writes its own errors and progress to a pipe as CLIXML, and in the
 * code page of the console. A script that decodes itself crosses the command line just as safely,
 * runs through `-Command`, and says what it has to say as text, in UTF-8.
 */
export function wrapInShellForPipes(
  launch: LaunchCommand,
  command: string,
  options: ShellOptions = {},
): LaunchCommand {
  const { platform = process.platform, env = process.env } = options;
  if (platform !== 'win32') return wrapInShell(launch, command, options);
  const shell = findOnPath('pwsh', env) ?? 'powershell.exe';
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    powerShellScript(command, launch.args),
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const decoder =
    `$s = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')); ` +
    '. ([ScriptBlock]::Create($s))';
  return { ...launch, file: shell, args: ['-NoLogo', '-NonInteractive', '-Command', decoder] };
}
