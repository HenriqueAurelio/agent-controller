import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expandWindowsVars, findOnPath, parseRegPath, resolveCli } from '../../src/core/forges/cli';

describe('the PATH Windows keeps now', () => {
  it('reads the value out of what reg query printed', () => {
    const out = [
      '',
      'HKEY_CURRENT_USER\\Environment',
      '    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Programs\\glab;C:\\bin;',
      '',
    ].join('\r\n');
    expect(parseRegPath(out)).toBe('%USERPROFILE%\\AppData\\Local\\Programs\\glab;C:\\bin;');
    expect(parseRegPath('    Path    REG_SZ    C:\\Windows\r\n')).toBe('C:\\Windows');
    expect(parseRegPath('ERROR: The system was unable to find the specified registry key')).toBe(
      '',
    );
  });

  it('expands the variables, whatever their case, and keeps unknown ones', () => {
    const env = { USERPROFILE: 'C:\\Users\\ana', SystemRoot: 'C:\\Windows' };
    expect(expandWindowsVars('%userprofile%\\bin;%SYSTEMROOT%;%NOPE%\\x', env)).toBe(
      'C:\\Users\\ana\\bin;C:\\Windows;%NOPE%\\x',
    );
  });

  it('finds a tool in the folders, trying each extension', () => {
    const glab = join('C:\\Users\\ana\\glab', 'glab.exe');
    const exists = (file: string) => file === glab;
    expect(findOnPath('glab', 'C:\\bin; ;C:\\Users\\ana\\glab', ['.COM', '.exe'], exists)).toBe(
      glab,
    );
    expect(findOnPath('gh', 'C:\\bin;C:\\Users\\ana\\glab', ['.exe'], exists)).toBeNull();
  });

  it.runIf(process.platform !== 'win32')('spawns the name itself outside Windows', async () => {
    expect(await resolveCli('glab', { PATH: '/nowhere' })).toBe('glab');
  });

  it.runIf(process.platform === 'win32')(
    'finds a tool the inherited PATH lacks in the one Windows keeps',
    async () => {
      // `reg` itself is in System32, on the machine's PATH: an empty inherited PATH must still
      // find it through the registry.
      const found = await resolveCli('reg', { ...process.env, Path: '', PATH: '' });
      expect(found.toLowerCase()).toMatch(/system32[\\/]reg\.exe$/);
      // On the inherited PATH: the name, as before.
      expect(await resolveCli('cmd')).toBe('cmd');
    },
  );
});
