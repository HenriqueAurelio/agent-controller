// The comments of the review of each session, kept on disk so closing the app loses none. One
// file for all sessions: a review is small, and it ends when it is sent.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { UserError } from '@shared/i18n';
import {
  REVIEW_COMMENT_TEXT_LIMIT,
  REVIEW_COMMENTS_LIMIT,
  REVIEW_LINE_LIMIT,
  REVIEW_SNIPPET_LIMIT,
  type NewReviewComment,
  type ReviewComment,
} from '@shared/review';
import { JsonStore } from '../store/JsonStore';

interface Stored {
  sessions: Record<string, ReviewComment[]>;
}

interface Events {
  changed: [sessionId: string, comments: ReviewComment[]];
}

export interface ReviewStoreOptions {
  file: string;
  now?: () => number;
  newId?: () => string;
}

const SESSION_ID = /^[\w-]{1,64}$/;

const isLine = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= REVIEW_LINE_LIMIT;

function cleanComment(value: unknown): ReviewComment | null {
  const c = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (typeof c.id !== 'string' || !c.id || c.id.length > 64) return null;
  if (typeof c.file !== 'string' || !c.file || c.file.length > 4096) return null;
  if (!isLine(c.startLine) || !isLine(c.endLine) || c.endLine < c.startLine) return null;
  if (typeof c.text !== 'string' || !c.text.trim()) return null;
  return {
    id: c.id,
    file: c.file,
    startLine: c.startLine,
    endLine: c.endLine,
    snippet: typeof c.snippet === 'string' ? c.snippet.slice(0, REVIEW_SNIPPET_LIMIT) : '',
    text: c.text.slice(0, REVIEW_COMMENT_TEXT_LIMIT),
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
  };
}

function cleanStored(data: unknown): Stored {
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const given = raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {};
  const sessions: Record<string, ReviewComment[]> = {};
  for (const [id, list] of Object.entries(given as Record<string, unknown>)) {
    if (!SESSION_ID.test(id) || !Array.isArray(list)) continue;
    const comments = list
      .map(cleanComment)
      .filter((c): c is ReviewComment => c !== null)
      .slice(0, REVIEW_COMMENTS_LIMIT);
    if (comments.length > 0) sessions[id] = comments;
  }
  return { sessions };
}

/** A path as the panel names files: relative, forward slashes, never climbing out. */
function cleanFile(file: string): string {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new UserError('error.review.badFile');
  }
  return normalized;
}

export class ReviewStore extends EventEmitter<Events> {
  private readonly store: JsonStore<Stored>;
  private data: Stored;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: ReviewStoreOptions) {
    super();
    this.store = new JsonStore<Stored>({
      file: options.file,
      version: 1,
      migrations: {},
      defaults: () => ({ sessions: {} }),
      validate: cleanStored,
    });
    this.data = this.store.load();
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => randomUUID());
  }

  list(sessionId: string): ReviewComment[] {
    return [...(this.data.sessions[sessionId] ?? [])];
  }

  add(sessionId: string, input: NewReviewComment): ReviewComment {
    const current = this.data.sessions[sessionId] ?? [];
    if (current.length >= REVIEW_COMMENTS_LIMIT) {
      throw new UserError('error.review.tooMany', { limit: REVIEW_COMMENTS_LIMIT });
    }
    const text = input.text.trim();
    if (!text) throw new UserError('error.review.empty');
    if (!isLine(input.startLine) || !isLine(input.endLine) || input.endLine < input.startLine) {
      throw new UserError('error.review.badLines');
    }
    const comment: ReviewComment = {
      id: this.newId(),
      file: cleanFile(input.file),
      startLine: input.startLine,
      endLine: input.endLine,
      snippet: input.snippet.slice(0, REVIEW_SNIPPET_LIMIT),
      text: text.slice(0, REVIEW_COMMENT_TEXT_LIMIT),
      createdAt: this.now(),
    };
    this.write(sessionId, [...current, comment]);
    return comment;
  }

  update(sessionId: string, id: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) throw new UserError('error.review.empty');
    const current = this.data.sessions[sessionId] ?? [];
    if (!current.some((c) => c.id === id)) throw new UserError('error.review.notFound');
    this.write(
      sessionId,
      current.map((c) =>
        c.id === id ? { ...c, text: trimmed.slice(0, REVIEW_COMMENT_TEXT_LIMIT) } : c,
      ),
    );
  }

  remove(sessionId: string, id: string): void {
    const current = this.data.sessions[sessionId] ?? [];
    const next = current.filter((c) => c.id !== id);
    if (next.length !== current.length) this.write(sessionId, next);
  }

  /** Drops the comments given (the ones that went to the agent), or all of them. */
  clear(sessionId: string, ids?: readonly string[]): void {
    const current = this.data.sessions[sessionId] ?? [];
    const next = ids ? current.filter((c) => !ids.includes(c.id)) : [];
    if (next.length !== current.length) this.write(sessionId, next);
  }

  /** The session was removed: its review goes with it, with no event for nobody to hear. */
  forget(sessionId: string): void {
    if (!this.data.sessions[sessionId]) return;
    delete this.data.sessions[sessionId];
    this.persist();
  }

  private write(sessionId: string, comments: ReviewComment[]): void {
    if (comments.length > 0) this.data.sessions[sessionId] = comments;
    else delete this.data.sessions[sessionId];
    this.persist();
    this.emit('changed', sessionId, this.list(sessionId));
  }

  private persist(): void {
    try {
      this.store.save(this.data);
    } catch {
      // The review stays in memory: losing it only on the next start is better than failing now.
    }
  }
}
