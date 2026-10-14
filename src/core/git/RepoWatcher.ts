import fs from 'node:fs';
import path from 'node:path';
import { ignoredPaths } from './GitService';

export interface RepoWatcherOptions {
  root: string;
  onChange: () => void;
  debounceMs?: number;
  /** Above this many distinct paths in one burst, stop asking git which are ignored. */
  maxTrackedPaths?: number;
}

// Inside .git, only what moves HEAD or the index changes what the panel shows. The repository
// may be the watched folder or any folder below it.
const GIT_FOLDER = /(^|\/)\.git(\/|$)/;
const GIT_RELEVANT = /(^|\/)\.git\/(HEAD|index|ORIG_HEAD|MERGE_HEAD|refs\/heads\/.*)$/;

function normalize(file: string): string {
  return file.split(path.sep).join('/');
}

/**
 * Watches a repository while the changes panel is open. A burst of writes becomes one refresh;
 * changes under `.git` and in ignored paths do not trigger any.
 */
export class RepoWatcher {
  private watcher: fs.FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending = new Set<string>();
  private overflow = false;
  private readonly debounceMs: number;
  private readonly maxTrackedPaths: number;

  constructor(private readonly options: RepoWatcherOptions) {
    this.debounceMs = options.debounceMs ?? 300;
    this.maxTrackedPaths = options.maxTrackedPaths ?? 200;
  }

  start(): void {
    if (this.watcher) return;
    try {
      this.watcher = fs.watch(this.options.root, { recursive: true }, (_event, file) => {
        this.onEvent(file ? normalize(file.toString()) : null);
      });
      this.watcher.on('error', () => this.stop());
    } catch {
      // The folder is gone or cannot be watched; the manual refresh still works.
      this.watcher = null;
    }
  }

  private onEvent(file: string | null): void {
    if (file === null) {
      this.overflow = true;
    } else if (GIT_FOLDER.test(file)) {
      if (!GIT_RELEVANT.test(file) || file.endsWith('.lock')) return;
      this.overflow = true; // HEAD or index moved: always refresh.
    } else if (this.pending.size >= this.maxTrackedPaths) {
      this.overflow = true;
    } else {
      this.pending.add(file);
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const files = [...this.pending];
    const overflow = this.overflow;
    this.pending = new Set();
    this.overflow = false;
    if (!overflow) {
      const ignored = await ignoredPaths(this.options.root, files).catch(() => new Set<string>());
      if (files.every((f) => ignored.has(f))) return;
    }
    if (this.watcher) this.options.onChange();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.watcher?.close();
    this.watcher = null;
  }
}
