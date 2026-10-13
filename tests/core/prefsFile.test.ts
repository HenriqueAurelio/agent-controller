import { describe, expect, it } from 'vitest';
import {
  parsePreferencesFile,
  PREFS_FILE_VERSION,
  serializePreferences,
} from '@core/store/prefsFile';
import {
  DEFAULT_PREFERENCES,
  FAVORITE_FOLDERS_LIMIT,
  isFavoriteFolder,
  sanitizeFavoriteFolders,
  sanitizePreferences,
  toggleFavoriteFolder,
  type Preferences,
} from '@shared/prefs';

describe('favorite folders', () => {
  it('adds at the end and removes, one entry per folder', () => {
    let favorites = toggleFavoriteFolder([], '/src/api');
    favorites = toggleFavoriteFolder(favorites, ' /src/web/ ');
    expect(favorites).toEqual(['/src/api', '/src/web']);
    expect(isFavoriteFolder(favorites, '/src/web')).toBe(true);
    expect(isFavoriteFolder(favorites, '/src/web/')).toBe(true);
    expect(isFavoriteFolder(favorites, '/src')).toBe(false);
    expect(toggleFavoriteFolder(favorites, '/src/api/')).toEqual(['/src/web']);
  });

  it('keeps the root of a drive and of the file system as they are', () => {
    expect(sanitizeFavoriteFolders(['C:\\', '/', 'C:\\Projetos\\'])).toEqual([
      'C:\\',
      '/',
      'C:\\Projetos',
    ]);
  });

  it('drops what is not a folder, repeats, and what goes over the limit', () => {
    expect(sanitizeFavoriteFolders(['/a', 7, '', '  ', null, '/a/', '/b'])).toEqual(['/a', '/b']);
    expect(sanitizeFavoriteFolders('x')).toEqual([]);
    const many = Array.from({ length: FAVORITE_FOLDERS_LIMIT + 5 }, (_, i) => `/p${i}`);
    expect(sanitizeFavoriteFolders(many)).toHaveLength(FAVORITE_FOLDERS_LIMIT);
    expect(sanitizePreferences(undefined).favoriteFolders).toEqual([]);
  });
});

describe('preferences file', () => {
  const chosen: Preferences = sanitizePreferences({
    ...DEFAULT_PREFERENCES,
    theme: 'light',
    fontSize: 16,
    defaultFolder: '/src',
    favoriteFolders: ['/src/api', '/src/web'],
    layout: { sessions: 'top', panel: 'right', files: 'bottom' },
    shortcuts: { ...DEFAULT_PREFERENCES.shortcuts, newSession: ['Ctrl+Alt+N'] },
  });

  it('comes back as it went', () => {
    expect(parsePreferencesFile(serializePreferences(chosen))).toEqual(chosen);
    expect(parsePreferencesFile(serializePreferences(DEFAULT_PREFERENCES))).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('fills what the file does not say, and fixes what it says wrongly, with the defaults', () => {
    const file = JSON.parse(serializePreferences(chosen));
    delete file.prefs.layout;
    file.prefs.fontSize = 'grande';
    file.prefs.favoriteFolders = ['/src/api', 3];
    file.prefs.extra = { anything: true };
    const read = parsePreferencesFile(JSON.stringify(file));
    expect(read).toEqual({
      ...chosen,
      layout: DEFAULT_PREFERENCES.layout,
      fontSize: DEFAULT_PREFERENCES.fontSize,
      favoriteFolders: ['/src/api'],
    });
  });

  it('refuses what is not a file of preferences', () => {
    const file = JSON.parse(serializePreferences(chosen));
    expect(() => parsePreferencesFile('{ "kind": ')).toThrow(/JSON/);
    expect(() => parsePreferencesFile('[]')).toThrow(/não é uma exportação/);
    expect(() => parsePreferencesFile('null')).toThrow(/não é uma exportação/);
    // The file of the sessions has no `kind`.
    expect(() => parsePreferencesFile(JSON.stringify({ version: 1, sessions: [] }))).toThrow(
      /não é uma exportação/,
    );
    expect(() =>
      parsePreferencesFile(JSON.stringify({ ...file, version: PREFS_FILE_VERSION + 1 })),
    ).toThrow(/versão mais nova/);
    expect(() => parsePreferencesFile(JSON.stringify({ ...file, prefs: [] }))).toThrow(
      /não tem configurações/,
    );
  });
});
