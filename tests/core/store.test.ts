import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppStore, defaultAppData } from '@core/store/appStore';
import { JsonStore } from '@core/store/JsonStore';
import { removeDir, tempDir } from './helpers';

let dir: string;
beforeEach(() => (dir = tempDir()));
afterEach(() => removeDir(dir));

const session = (id: string, order = 0) => ({
  id,
  name: `Sessão ${id}`,
  cwd: dir,
  profile: 'codex' as const,
  order,
});

describe('appStore', () => {
  it('returns defaults when there is no file', () => {
    const store = createAppStore(dir);
    expect(store.load()).toEqual(defaultAppData());
    expect(store.lastLoadSource).toBe('defaults');
  });

  it('saves and loads sessions', () => {
    const store = createAppStore(dir);
    const data = {
      ...defaultAppData(),
      sessions: [session('a'), session('b', 1)],
      selectedSessionId: 'b',
    };
    store.save(data);
    const loaded = createAppStore(dir).load();
    expect(loaded.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(loaded.selectedSessionId).toBe('b');
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('falls back to the backup when the file is corrupted', () => {
    const store = createAppStore(dir);
    store.save({ ...defaultAppData(), sessions: [session('a')] });
    store.save({ ...defaultAppData(), sessions: [session('a'), session('b', 1)] });
    fs.writeFileSync(store.file, '{ "sessions": [ {"id": ');
    const loaded = store.load();
    expect(store.lastLoadSource).toBe('backup');
    expect(loaded.sessions.map((s) => s.id)).toEqual(['a']);
  });

  it('does not replace a good backup with a corrupted file', () => {
    const store = createAppStore(dir);
    store.save({ ...defaultAppData(), sessions: [session('a')] });
    store.save({ ...defaultAppData(), sessions: [session('b')] });
    fs.writeFileSync(store.file, 'lixo');
    store.save({ ...defaultAppData(), sessions: [session('c')] });
    expect(JSON.parse(fs.readFileSync(store.backupFile, 'utf8')).sessions[0].id).toBe('a');
    expect(store.load().sessions[0]!.id).toBe('c');
  });

  it('uses defaults when file and backup are both unreadable', () => {
    const store = createAppStore(dir);
    fs.writeFileSync(store.file, 'lixo');
    fs.writeFileSync(store.backupFile, '[]');
    expect(store.load().sessions).toEqual([]);
    expect(store.lastLoadSource).toBe('defaults');
  });

  it('never persists state, history or environment', () => {
    const store = createAppStore(dir);
    const leaky = {
      ...session('a'),
      status: { state: 'trabalhando' },
      env: { TOKEN: 'x' },
      history: 'ls',
    };
    store.save({ ...defaultAppData(), sessions: [leaky] });
    expect(Object.keys(store.load().sessions[0]!).sort()).toEqual([
      'cwd',
      'id',
      'name',
      'order',
      'profile',
    ]);
  });

  it('drops sessions with an unknown profile or duplicated id', () => {
    const store = createAppStore(dir);
    fs.writeFileSync(
      store.file,
      JSON.stringify({
        version: 1,
        sessions: [
          session('a'),
          session('a'),
          { ...session('b'), profile: 'bash' },
          session('c', 7),
        ],
      }),
    );
    const loaded = store.load();
    expect(loaded.sessions.map((s) => [s.id, s.order])).toEqual([
      ['a', 0],
      ['c', 1],
    ]);
  });

  it('migrates a file written before the schema had a version', () => {
    const store = createAppStore(dir);
    fs.writeFileSync(store.file, JSON.stringify({ sessions: [session('a')] }));
    const loaded = store.load();
    expect(loaded.version).toBe(1);
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.prefs.scrollback).toBeGreaterThan(0);
  });
});

describe('JsonStore migrations', () => {
  interface V3 {
    version: number;
    items: { title: string }[];
  }
  const make = () =>
    new JsonStore<V3>({
      file: path.join(dir, 'data.json'),
      version: 3,
      defaults: () => ({ version: 3, items: [] }),
      migrations: {
        0: (d) => ({ ...d, names: d.list }),
        1: (d) => ({ ...d, items: (d.names as string[]).map((name) => ({ name })) }),
        2: (d) => ({
          items: (d.items as { name: string }[]).map((i) => ({ title: i.name.toUpperCase() })),
        }),
      },
    });

  it('runs every step from the version on disk', () => {
    fs.writeFileSync(
      path.join(dir, 'data.json'),
      JSON.stringify({ version: 1, names: ['a', 'b'] }),
    );
    expect(make().load()).toEqual({ version: 3, items: [{ title: 'A' }, { title: 'B' }] });
  });

  it('starts at version 0 when the field is missing', () => {
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ list: ['x'] }));
    expect(make().load().items).toEqual([{ title: 'X' }]);
  });

  it('refuses a file from a newer version instead of mangling it', () => {
    const store = make();
    fs.writeFileSync(store.file, JSON.stringify({ version: 9, items: [{ title: 'futuro' }] }));
    expect(store.load().items).toEqual([]);
    expect(store.lastLoadSource).toBe('defaults');
  });
});
