import fs from 'node:fs';
import path from 'node:path';

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

export interface JsonStoreOptions<T> {
  file: string;
  /** Current schema version. Data on disk carries it in the `version` field. */
  version: number;
  /** `migrations[n]` upgrades data from version n to n + 1. */
  migrations: Record<number, Migration>;
  defaults: () => T;
  /** Final shape check after migration; throws or repairs. */
  validate?: (data: unknown) => T;
}

export type LoadSource = 'file' | 'backup' | 'defaults';

/**
 * A JSON file with atomic writes (temp file + rename), a copy of the previous version and a
 * schema version with migrations.
 */
export class JsonStore<T extends object> {
  readonly file: string;
  readonly backupFile: string;
  lastLoadSource: LoadSource = 'defaults';

  constructor(private readonly options: JsonStoreOptions<T>) {
    this.file = options.file;
    this.backupFile = `${options.file}.bak`;
  }

  load(): T {
    for (const [source, file] of [
      ['file', this.file],
      ['backup', this.backupFile],
    ] as const) {
      const data = this.tryRead(file);
      if (data) {
        this.lastLoadSource = source;
        return data;
      }
    }
    this.lastLoadSource = 'defaults';
    return this.options.defaults();
  }

  private tryRead(file: string): T | null {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    try {
      const raw: unknown = JSON.parse(text);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const migrated = this.migrate(raw as Record<string, unknown>);
      return this.options.validate ? this.options.validate(migrated) : (migrated as T);
    } catch {
      return null;
    }
  }

  private migrate(data: Record<string, unknown>): Record<string, unknown> {
    let version = typeof data.version === 'number' ? data.version : 0;
    if (version > this.options.version) {
      throw new Error(`Arquivo de uma versão mais nova do app (schema ${version})`);
    }
    let current = data;
    while (version < this.options.version) {
      const step = this.options.migrations[version];
      if (!step) throw new Error(`Sem migração do schema ${version}`);
      current = step(current);
      version++;
    }
    return { ...current, version: this.options.version };
  }

  save(data: T): void {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const json = JSON.stringify({ ...data, version: this.options.version }, null, 2);
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeFileSync(fd, json, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Only a file that still parses is worth keeping as the backup.
    if (this.tryRead(this.file)) {
      try {
        fs.copyFileSync(this.file, this.backupFile);
      } catch {
        // A missing backup is not a reason to lose the new data.
      }
    }
    fs.renameSync(tmp, this.file);
  }
}
