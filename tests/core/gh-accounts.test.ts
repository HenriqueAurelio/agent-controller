import { describe, expect, it } from 'vitest';
import { parseGhStatusJson, parseGhStatusText } from '../../src/core/forges/github';

describe('the accounts of gh', () => {
  it('reads them from gh auth status --json hosts', () => {
    const out = JSON.stringify({
      hosts: {
        'github.com': [
          { state: 'success', active: true, host: 'github.com', login: 'henriquecodefique' },
          { state: 'success', active: false, host: 'github.com', login: 'HenriqueAurelio' },
        ],
        'ghe.empresa.com': [{ active: true, login: 'outra' }],
      },
    });
    expect(parseGhStatusJson(out)).toEqual({
      accounts: ['henriquecodefique', 'HenriqueAurelio'],
      active: 'henriquecodefique',
    });
    expect(parseGhStatusJson('{"hosts":{}}')).toEqual({ accounts: [], active: '' });
  });

  it('reads them from the text of an older gh', () => {
    const text = [
      'github.com',
      '  ✓ Logged in to github.com account henriquecodefique (keyring)',
      '  - Active account: false',
      '',
      '  ✓ Logged in to github.com account HenriqueAurelio (keyring)',
      '  - Active account: true',
    ].join('\r\n');
    expect(parseGhStatusText(text)).toEqual({
      accounts: ['henriquecodefique', 'HenriqueAurelio'],
      active: 'HenriqueAurelio',
    });
    // Before many accounts, gh said "as" and had a single one.
    expect(parseGhStatusText('  ✓ Logged in to github.com as ana (oauth_token)')).toEqual({
      accounts: ['ana'],
      active: 'ana',
    });
    expect(parseGhStatusText('You are not logged into any GitHub hosts.')).toEqual({
      accounts: [],
      active: '',
    });
  });
});
