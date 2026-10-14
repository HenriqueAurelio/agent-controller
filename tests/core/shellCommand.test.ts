import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parsePreferencesFile, serializePreferences } from '@core/store/prefsFile';
import { AGENT_COMMAND_LIMIT, sanitizeAgentCommand } from '@shared/agents';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '@shared/prefs';
import {
  powerShellScript,
  quotePosix,
  quotePowerShell,
  wrapInShell,
  type LaunchCommand,
} from '@core/agents';

const launch: LaunchCommand = {
  file: 'claude',
  args: ['--settings', 'C:\\Users\\Ana Maria\\settings.json'],
  env: { AGENTCTL_SESSION_ID: 'abc' },
};

/** Arguments that a shell would take apart, or read as something else, if badly quoted. */
const AWKWARD = ['plain', 'two words', "it's", 'a"b', '$HOME `x` $(y)', 'C:\\dir with space\\', ''];

const run = (file: string, args: string[]) =>
  new Promise<{ code: number; stdout: string }>((resolve) => {
    const child = execFile(file, args, { windowsHide: true, timeout: 60_000 }, (err, stdout) => {
      resolve({ code: typeof err?.code === 'number' ? err.code : err ? 1 : 0, stdout });
    });
    child.stdin?.end();
  });

describe('the command asked for', () => {
  it('is one line of text, within a limit', () => {
    expect(sanitizeAgentCommand('  claude-work --model opus ')).toBe('claude-work --model opus');
    expect(sanitizeAgentCommand('')).toBe('');
    expect(sanitizeAgentCommand('a\nb')).toBe('');
    expect(sanitizeAgentCommand('a\u0000b')).toBe('');
    expect(sanitizeAgentCommand('x'.repeat(AGENT_COMMAND_LIMIT + 1))).toBe('');
    expect(sanitizeAgentCommand(7)).toBe('');
  });

  it('is a preference per agent, exported and imported with the others', () => {
    expect(DEFAULT_PREFERENCES.agentCommands).toEqual({ 'claude-code': '', codex: '' });
    // A file from before the commands existed, or with garbage in their place.
    expect(sanitizePreferences({}).agentCommands).toEqual(DEFAULT_PREFERENCES.agentCommands);
    expect(sanitizePreferences({ agentCommands: 'x' as never }).agentCommands).toEqual(
      DEFAULT_PREFERENCES.agentCommands,
    );
    const chosen = {
      ...DEFAULT_PREFERENCES,
      agentCommands: { 'claude-code': ' claude-work ', codex: 'a\nb', other: 'x' } as never,
    };
    const file = serializePreferences(sanitizePreferences(chosen));
    expect(parsePreferencesFile(file).agentCommands).toEqual({
      'claude-code': 'claude-work',
      codex: '',
    });
  });
});

const decode = (encoded: string) => Buffer.from(encoded, 'base64').toString('utf16le');

describe('a command of the user in place of the agent', () => {
  it('quotes for each shell', () => {
    expect(quotePosix('--settings')).toBe('--settings');
    expect(quotePosix('/home/ana/a.json')).toBe('/home/ana/a.json');
    expect(quotePosix('two words')).toBe("'two words'");
    expect(quotePosix("it's")).toBe(`'it'\\''s'`);
    expect(quotePosix('')).toBe("''");
    expect(quotePowerShell('--settings')).toBe("'--settings'");
    expect(quotePowerShell("it's")).toBe("'it''s'");
  });

  it('on POSIX runs in the interactive shell of the user, with the arguments of the app', () => {
    const wrapped = wrapInShell(launch, 'claude-work --model opus', {
      platform: 'linux',
      env: { SHELL: '/bin/zsh' },
    });
    expect(wrapped.file).toBe('/bin/zsh');
    expect(wrapped.args).toEqual([
      '-i',
      '-c',
      "claude-work --model opus --settings 'C:\\Users\\Ana Maria\\settings.json'",
    ]);
    // What tells the sessions apart goes along.
    expect(wrapped.env).toEqual(launch.env);
    expect(wrapInShell(launch, 'x', { platform: 'linux', env: {} }).file).toBe('/bin/bash');
  });

  it('on Windows runs in PowerShell, with the profile and the script encoded', () => {
    const wrapped = wrapInShell(launch, 'claude-work', { platform: 'win32', env: { PATH: '' } });
    expect(wrapped.file).toBe('powershell.exe');
    expect(wrapped.args.slice(0, 2)).toEqual(['-NoLogo', '-EncodedCommand']);
    expect(wrapped.args).not.toContain('-NoProfile');
    expect(decode(wrapped.args[2]!)).toBe(powerShellScript('claude-work', launch.args));
    expect(powerShellScript('claude-work', launch.args)).toContain(
      "claude-work '--settings' 'C:\\Users\\Ana Maria\\settings.json'",
    );
    expect(wrapped.env).toEqual(launch.env);
  });

  // The real shells: every argument arrives whole, and the exit code is the one of the command.
  it.runIf(process.platform !== 'win32')('POSIX: arguments and exit code survive', async () => {
    const env = { SHELL: '/bin/bash' };
    const echo = wrapInShell({ ...launch, args: AWKWARD }, "printf '%s\\n'", { env });
    const printed = await run(echo.file, echo.args);
    expect(printed.stdout.split('\n').slice(0, AWKWARD.length)).toEqual(AWKWARD);
    const failing = wrapInShell({ ...launch, args: [] }, 'exit 7', { env });
    expect((await run(failing.file, failing.args)).code).toBe(7);
  });

  it.runIf(process.platform === 'win32')(
    'Windows: arguments and exit code survive, and a function is a command',
    async () => {
      const args = (command: string, list: string[]) => [
        '-NoProfile',
        ...wrapInShell({ ...launch, args: list }, command).args,
      ];
      const shell = wrapInShell(launch, 'x').file;
      // A function, as the ones of a profile, handing its arguments on.
      const viaFunction =
        'function Show-Args { foreach ($a in $args) { "[$a]" } }; function my-agent { Show-Args @args }; my-agent';
      const printed = await run(shell, args(viaFunction, AWKWARD));
      expect(printed.stdout.split(/\r?\n/).slice(0, AWKWARD.length)).toEqual(
        AWKWARD.map((a) => `[${a}]`),
      );
      expect((await run(shell, args('cmd.exe /c exit 7', []))).code).toBe(7);
      expect((await run(shell, args('no-such-command-here', []))).code).toBe(1);
    },
    120_000,
  );
});
