import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { ChecksRun } from '@shared/checks';
import { UserError } from '@shared/i18n';
import {
  PROMPT_TEXT_LIMIT,
  QUEUE_CONDITIONS,
  QUEUE_LIMIT,
  PROBLEMS_TEXT_LIMIT,
  SELECTION_LIMIT,
  type PromptValues,
  type QueueBlock,
  type QueueCondition,
  type QueueItem,
  type QueueItemUpdate,
  type QueueState,
  type QueueSummary,
} from '@shared/prompts';
import { isBusyForText, type SessionStatus } from '@shared/session';
import { JsonStore } from '../store/JsonStore';

/** What the queue needs to know of the agent of a session. */
export interface QueueAgentState {
  status: SessionStatus;
  running: boolean;
}

export interface PromptQueueOptions {
  /** Where the queues are kept, one file per session. */
  directory: string;
  /** The sessions that exist: a queue of any other is left over, and deleted. */
  sessionIds: readonly string[];
  stateOf(sessionId: string): QueueAgentState | null;
  /**
   * Hands an item to the agent, with Enter, filling in its variables now. Throws when it cannot;
   * the message of the error is shown as it is.
   */
  deliver(sessionId: string, item: QueueItem): Promise<void>;
  /** Runs every check of the folder of the session. False when it has none. */
  runChecks(sessionId: string): boolean;
}

interface QueueEvents {
  changed: [sessionId: string, state: QueueState];
}

interface StoredQueue {
  items: QueueItem[];
}

interface Queue {
  items: QueueItem[];
  paused: boolean;
  blockedBy?: QueueBlock;
  error?: string;
  /** A run of the checks was asked for the first item; its result decides whether it goes. */
  checking: boolean;
  /** An item is on its way to the agent. */
  sending: boolean;
  /**
   * An item went, and the agent has not moved since. Until it does, the state on screen is the
   * one from before the item: it says nothing about the turn the item starts.
   */
  inFlight: boolean;
  store: JsonStore<StoredQueue> | null;
}

const ID = /^[\w-]{1,64}$/;
const FILE_SUFFIX = '.json';

function cleanValues(value: unknown): PromptValues {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const answers: Record<string, string> = {};
  if (v.answers && typeof v.answers === 'object') {
    for (const [question, answer] of Object.entries(v.answers).slice(0, 50)) {
      if (typeof answer === 'string') answers[question] = answer.slice(0, 8000);
    }
  }
  return {
    ...(typeof v.file === 'string' && { file: v.file.slice(0, 4096) }),
    ...(typeof v.selection === 'string' && { selection: v.selection.slice(0, SELECTION_LIMIT) }),
    ...(typeof v.problems === 'string' && { problems: v.problems.slice(0, PROBLEMS_TEXT_LIMIT) }),
    answers,
  };
}

const isCondition = (value: unknown): value is QueueCondition =>
  QUEUE_CONDITIONS.includes(value as QueueCondition);

/** What is left of a file of a queue that can be trusted: valid items, at most the limit. */
function cleanStored(data: unknown): StoredQueue {
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const items: QueueItem[] = [];
  const ids = new Set<string>();
  for (const value of Array.isArray(raw.items) ? raw.items : []) {
    if (items.length >= QUEUE_LIMIT) break;
    const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    if (typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id)) continue;
    if (typeof item.text !== 'string' || item.text.length > PROMPT_TEXT_LIMIT) continue;
    if (!item.text.trim()) continue;
    ids.add(item.id);
    items.push({
      id: item.id,
      text: item.text,
      values: cleanValues(item.values),
      condition: isCondition(item.condition) ? item.condition : 'turnEnd',
    });
  }
  return { items };
}

/**
 * Whether the agent is at its prompt, between turns: a text it gets now starts a new turn. Only a
 * state the agent confirmed counts; one guessed from silence never sends anything by itself.
 */
export function readyForQueue(agent: QueueAgentState | null): boolean {
  if (!agent?.running || !agent.status.confirmed) return false;
  const { state } = agent.status;
  return state === 'terminou' || (state === 'aguardando' && !isBusyForText(agent.status));
}

/**
 * The queue of prompts of each session: the next one goes when the agent ends its turn, or, when
 * the item asks for it, once the checks of the folder passed. It only moves on "done", never on
 * "waiting": a question of the agent is the user's to answer. Kept on disk; a queue read back
 * when the app opens again comes back paused.
 */
export class PromptQueue extends EventEmitter<QueueEvents> {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly options: PromptQueueOptions) {
    super();
    this.load(new Set(options.sessionIds));
  }

  private load(known: ReadonlySet<string>): void {
    let files: string[];
    try {
      files = fs.readdirSync(this.options.directory);
    } catch {
      return; // No queue was ever kept.
    }
    for (const file of files) {
      if (!file.endsWith(FILE_SUFFIX)) continue;
      const sessionId = file.slice(0, -FILE_SUFFIX.length);
      if (!known.has(sessionId) || !ID.test(sessionId)) {
        // The session was closed while the app was not looking: its queue goes with it.
        this.deleteFiles(path.join(this.options.directory, file));
        continue;
      }
      const queue = this.queue(sessionId);
      queue.items = queue.store?.load().items ?? [];
      if (queue.items.length) {
        queue.paused = true;
        queue.blockedBy = 'restored';
      }
    }
  }

  private queue(sessionId: string): Queue {
    let queue = this.queues.get(sessionId);
    if (!queue) {
      queue = {
        items: [],
        paused: false,
        checking: false,
        sending: false,
        inFlight: false,
        store: ID.test(sessionId)
          ? new JsonStore<StoredQueue>({
              file: path.join(this.options.directory, `${sessionId}${FILE_SUFFIX}`),
              version: 1,
              migrations: {},
              defaults: () => ({ items: [] }),
              validate: cleanStored,
            })
          : null,
      };
      this.queues.set(sessionId, queue);
    }
    return queue;
  }

  get(sessionId: string): QueueState {
    const queue = this.queues.get(sessionId);
    if (!queue) return { items: [], paused: false };
    return {
      items: queue.items.map((item) => ({ ...item })),
      paused: queue.paused,
      ...(queue.blockedBy && { blockedBy: queue.blockedBy }),
      ...(queue.checking && { checking: true }),
      ...(queue.error && { error: queue.error }),
    };
  }

  /** What the list of sessions shows; undefined for an empty queue. */
  summary(sessionId: string): QueueSummary | undefined {
    const queue = this.queues.get(sessionId);
    if (!queue?.items.length) return undefined;
    return {
      items: queue.items.length,
      paused: queue.paused,
      ...(queue.blockedBy && { blockedBy: queue.blockedBy }),
    };
  }

  /** Sessions with something in their queue. */
  sessions(): string[] {
    return [...this.queues].filter(([, queue]) => queue.items.length).map(([id]) => id);
  }

  /** Puts a prompt at the end of the queue. A free agent gets it at once. */
  add(
    sessionId: string,
    input: { text: string; values?: PromptValues; condition?: QueueCondition },
  ): QueueItem {
    const queue = this.queue(sessionId);
    if (queue.items.length >= QUEUE_LIMIT) {
      throw new UserError('error.queue.full', { limit: QUEUE_LIMIT });
    }
    if (!input.text.trim()) throw new UserError('error.queue.empty');
    const item: QueueItem = {
      id: randomUUID(),
      text: input.text.slice(0, PROMPT_TEXT_LIMIT),
      values: cleanValues(input.values),
      condition: isCondition(input.condition) ? input.condition : 'turnEnd',
    };
    queue.items.push(item);
    this.save(sessionId, queue);
    this.changed(sessionId);
    this.advanceIfReady(sessionId);
    return { ...item };
  }

  /** Whether `count` more items fit in the queue of the session. */
  fits(sessionId: string, count = 1): boolean {
    return (this.queues.get(sessionId)?.items.length ?? 0) + count <= QUEUE_LIMIT;
  }

  update(sessionId: string, itemId: string, update: QueueItemUpdate): void {
    const queue = this.queues.get(sessionId);
    const index = queue?.items.findIndex((item) => item.id === itemId) ?? -1;
    if (!queue || index < 0) throw new UserError('error.queue.itemNotFound');
    const item = queue.items[index]!;
    if (update.text !== undefined && !update.text.trim()) throw new UserError('error.queue.empty');
    const condition = update.condition ?? item.condition;
    queue.items[index] = {
      ...item,
      ...(update.text !== undefined && { text: update.text.slice(0, PROMPT_TEXT_LIMIT) }),
      condition: isCondition(condition) ? condition : item.condition,
    };
    // The first item no longer asks for checks: the run going on decides nothing.
    if (index === 0 && queue.checking && queue.items[0]!.condition !== 'checksPassed') {
      queue.checking = false;
      this.save(sessionId, queue);
      this.changed(sessionId);
      this.advanceIfReady(sessionId);
      return;
    }
    this.save(sessionId, queue);
    this.changed(sessionId);
  }

  remove(sessionId: string, itemId: string): void {
    const queue = this.queues.get(sessionId);
    const index = queue?.items.findIndex((item) => item.id === itemId) ?? -1;
    if (!queue || index < 0) return;
    queue.items.splice(index, 1);
    // The checks were for the item that left.
    if (index === 0) queue.checking = false;
    if (!queue.items.length) this.emptied(queue);
    this.save(sessionId, queue);
    this.changed(sessionId);
    if (index === 0) this.advanceIfReady(sessionId);
  }

  /** The items in this order; ids it does not name keep their place after the ones it does. */
  reorder(sessionId: string, itemIds: readonly string[]): void {
    const queue = this.queues.get(sessionId);
    if (!queue) return;
    const byId = new Map(queue.items.map((item) => [item.id, item]));
    const named = [...new Set(itemIds)].flatMap((id) => byId.get(id) ?? []);
    const before = queue.items[0];
    queue.items = [...named, ...queue.items.filter((item) => !named.includes(item))];
    const newHead = queue.items[0] !== before;
    if (newHead) queue.checking = false;
    this.save(sessionId, queue);
    this.changed(sessionId);
    if (newHead) this.advanceIfReady(sessionId);
  }

  pause(sessionId: string): void {
    const queue = this.queues.get(sessionId);
    if (!queue || (queue.paused && !queue.blockedBy)) return;
    queue.paused = true;
    queue.checking = false;
    delete queue.blockedBy;
    delete queue.error;
    this.changed(sessionId);
  }

  /**
   * The queue moves again. A free agent gets the first item at once, unless `afterTurn`: then it
   * waits for the end of the next turn, as after the error of the checks was handed to the agent.
   */
  resume(sessionId: string, options: { afterTurn?: boolean } = {}): void {
    const queue = this.queues.get(sessionId);
    if (!queue) return;
    queue.paused = false;
    this.clearBlock(queue);
    this.changed(sessionId);
    if (!options.afterTurn) this.advanceIfReady(sessionId);
  }

  /**
   * The user's own click: the first item goes now, whatever its condition. It is how a session
   * whose agent sends no signal moves its queue.
   */
  async sendNext(sessionId: string): Promise<void> {
    const queue = this.queues.get(sessionId);
    if (!queue?.items.length || queue.sending) return;
    queue.checking = false;
    if (queue.blockedBy === 'agentAsks') delete queue.blockedBy;
    await this.send(sessionId, queue, { manual: true });
  }

  /** The state of the agent of a session changed. */
  onTransition(
    sessionId: string,
    status: SessionStatus,
    previous: SessionStatus,
    running: boolean,
  ) {
    const queue = this.queues.get(sessionId);
    if (!queue) return;
    // Even with nothing left: an item put in later must know the agent moved since the last one.
    if (status.state !== previous.state) queue.inFlight = false;
    if (!queue.items.length) return;
    if (!running) {
      // Nobody is left to receive the items.
      queue.checking = false;
      if (!queue.paused) {
        queue.paused = true;
        queue.blockedBy = 'exited';
        delete queue.error;
      }
      this.changed(sessionId);
      return;
    }
    if (status.state === 'aguardando' && status.confirmed && isBusyForText(status)) {
      // A permission or a question: the answer is the user's, and the queue waits for the next
      // end of turn.
      if (!queue.paused && queue.blockedBy !== 'agentAsks') {
        queue.blockedBy = 'agentAsks';
        this.changed(sessionId);
      }
      return;
    }
    if (queue.blockedBy === 'agentAsks' && status.state !== 'aguardando') {
      delete queue.blockedBy;
      this.changed(sessionId);
    }
    const turnEnded =
      status.state === 'terminou' && previous.state !== 'terminou' && status.confirmed;
    if (turnEnded) this.advance(sessionId, queue);
  }

  /** A run of the checks of a session changed. */
  onChecks(sessionId: string, run: ChecksRun | null): void {
    const queue = this.queues.get(sessionId);
    if (!queue?.checking || !run) return;
    if (run.state === 'cancelled') {
      // The agent went back to work: the next end of turn checks again.
      queue.checking = false;
      this.changed(sessionId);
      return;
    }
    if (run.state !== 'done') return;
    queue.checking = false;
    const passed =
      run.results.length > 0 && run.results.every((result) => result.outcome === 'passed');
    if (!passed) {
      queue.paused = true;
      queue.blockedBy = 'checksFailed';
      this.changed(sessionId);
      return;
    }
    this.changed(sessionId);
    if (!queue.paused) void this.send(sessionId, queue);
  }

  /** The session is gone: its queue, and its file, too. */
  forget(sessionId: string): void {
    const queue = this.queues.get(sessionId);
    this.queues.delete(sessionId);
    if (queue?.store) this.deleteFiles(queue.store.file);
  }

  private clearBlock(queue: Queue): void {
    delete queue.blockedBy;
    delete queue.error;
  }

  /** Nothing left to wait for: the next item put in runs as in a new queue. */
  private emptied(queue: Queue): void {
    queue.paused = false;
    queue.checking = false;
    this.clearBlock(queue);
  }

  private advanceIfReady(sessionId: string): void {
    const queue = this.queues.get(sessionId);
    if (queue && readyForQueue(this.options.stateOf(sessionId))) this.advance(sessionId, queue);
  }

  /** The turn is over: the first item goes, or its checks run first. */
  private advance(sessionId: string, queue: Queue): void {
    if (queue.paused || queue.sending || queue.checking || queue.inFlight) return;
    const head = queue.items[0];
    if (!head) return;
    if (head.condition === 'checksPassed') {
      if (!this.options.runChecks(sessionId)) {
        queue.paused = true;
        queue.blockedBy = 'noChecks';
      } else {
        // Set after the request: a run it replaced says "cancelled" on the way.
        queue.checking = true;
      }
      this.changed(sessionId);
      return;
    }
    void this.send(sessionId, queue);
  }

  private async send(sessionId: string, queue: Queue, options: { manual?: boolean } = {}) {
    const item = queue.items[0];
    if (!item || queue.sending) return;
    queue.sending = true;
    try {
      await this.options.deliver(sessionId, item);
    } catch (err) {
      queue.sending = false;
      if (this.queues.get(sessionId) !== queue) return;
      if (options.manual) throw err;
      queue.paused = true;
      queue.blockedBy = 'sendFailed';
      queue.error = err instanceof Error ? err.message : String(err);
      this.changed(sessionId);
      return;
    }
    queue.sending = false;
    if (this.queues.get(sessionId) !== queue) return;
    queue.items = queue.items.filter((other) => other.id !== item.id);
    queue.inFlight = true;
    if (!queue.items.length) this.emptied(queue);
    this.save(sessionId, queue);
    this.changed(sessionId);
  }

  private save(sessionId: string, queue: Queue): void {
    if (!queue.store || this.queues.get(sessionId) !== queue) return;
    try {
      if (queue.items.length) queue.store.save({ items: queue.items });
      else this.deleteFiles(queue.store.file);
    } catch (err) {
      console.error('Falha ao salvar a fila de prompts:', err);
    }
  }

  private deleteFiles(file: string): void {
    for (const target of [file, `${file}.bak`]) fs.rmSync(target, { force: true });
  }

  private changed(sessionId: string): void {
    this.emit('changed', sessionId, this.get(sessionId));
  }
}
