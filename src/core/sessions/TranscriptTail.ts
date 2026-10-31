import fs from 'node:fs/promises';

/** Read at most this much per call, so a long conversation read the first time does not stall. */
const CHUNK_BYTES = 1024 * 1024;

/**
 * Follows a file that only grows (an agent's conversation): each `read` hands over the complete
 * lines written since the previous one. A line still being written waits for the next read. A
 * file that shrank was replaced, and is read again from the start.
 */
export class TranscriptTail {
  private offset = 0;
  private partial = '';
  private reading: Promise<boolean> | null = null;

  constructor(
    readonly path: string,
    private readonly onLine: (line: string) => void,
  ) {}

  /** Resolves true when new lines were read. Concurrent calls share the read in progress. */
  read(): Promise<boolean> {
    this.reading ??= this.readNew().finally(() => (this.reading = null));
    return this.reading;
  }

  private async readNew(): Promise<boolean> {
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(this.path, 'r');
    } catch {
      return false;
    }
    try {
      const { size } = await handle.stat();
      if (size < this.offset) {
        this.offset = 0;
        this.partial = '';
      }
      let read = false;
      while (this.offset < size) {
        const length = Math.min(CHUNK_BYTES, size - this.offset);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
        if (bytesRead === 0) break;
        this.offset += bytesRead;
        // A multi-byte character split between two reads stays in `partial` as bytes would not:
        // decoding is done on whole lines only.
        const text = this.partial + buffer.subarray(0, bytesRead).toString('latin1');
        const lines = text.split('\n');
        this.partial = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          this.onLine(Buffer.from(line, 'latin1').toString('utf8'));
          read = true;
        }
        // Let other work run between chunks of a long file.
        if (this.offset < size) await new Promise((resolve) => setImmediate(resolve));
      }
      return read;
    } finally {
      await handle.close();
    }
  }
}
