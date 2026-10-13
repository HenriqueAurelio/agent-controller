export type StreamEvent =
  | { type: 'title'; title: string }
  | { type: 'bell' }
  /** OSC 9 or OSC 777: a desktop notification requested by the program. */
  | { type: 'notification'; text: string };

const ESC = 0x1b;
const BEL = 0x07;
const ST = 0x9c;
const OSC = 0x9d;
const BACKSLASH = 0x5c;
const BRACKET = 0x5d;
const MAX_OSC_LENGTH = 8192;

type State = 'ground' | 'esc' | 'osc' | 'osc-esc';

/**
 * Reads the raw PTY stream and extracts the window title (OSC 0 and 2), BEL and notification
 * sequences. Sequences may be split across chunks, so the state survives between calls.
 */
export class StreamParser {
  private state: State = 'ground';
  private osc = '';

  feed(chunk: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    let oscStart = this.state === 'osc' ? 0 : -1;

    const flushOsc = (end: number) => {
      if (oscStart >= 0) this.osc += chunk.slice(oscStart, end);
      oscStart = -1;
    };

    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      switch (this.state) {
        case 'ground':
          if (c === ESC) this.state = 'esc';
          else if (c === BEL) events.push({ type: 'bell' });
          else if (c === OSC) {
            this.state = 'osc';
            this.osc = '';
            oscStart = i + 1;
          }
          break;
        case 'esc':
          if (c === BRACKET) {
            this.state = 'osc';
            this.osc = '';
            oscStart = i + 1;
          } else if (c !== ESC) {
            this.state = 'ground';
          }
          break;
        case 'osc':
          if (c === BEL || c === ST) {
            flushOsc(i);
            this.finish(events);
          } else if (c === ESC) {
            flushOsc(i);
            this.state = 'osc-esc';
          } else if (this.osc.length + (i - oscStart) > MAX_OSC_LENGTH) {
            // Not a sequence we care about; give up instead of buffering without limit.
            oscStart = -1;
            this.osc = '';
            this.state = 'ground';
          }
          break;
        case 'osc-esc':
          if (c === BACKSLASH) {
            this.finish(events);
          } else {
            // ESC without ST cancels the OSC and starts a new escape sequence.
            this.osc = '';
            this.state = 'esc';
            i--;
          }
          break;
      }
    }
    if (this.state === 'osc') flushOsc(chunk.length);
    return events;
  }

  private finish(events: StreamEvent[]): void {
    const body = this.osc;
    this.osc = '';
    this.state = 'ground';
    const sep = body.indexOf(';');
    const code = sep === -1 ? body : body.slice(0, sep);
    const text = sep === -1 ? '' : body.slice(sep + 1);
    if (code === '0' || code === '2') {
      events.push({ type: 'title', title: text });
    } else if (code === '9') {
      // `OSC 9 ; 4 ; ...` is the ConEmu progress report, not a notification.
      if (!/^4;/.test(text)) events.push({ type: 'notification', text });
    } else if (code === '777') {
      const parts = text.split(';');
      if (parts[0] === 'notify') {
        events.push({ type: 'notification', text: parts.slice(1).join(': ') });
      }
    }
  }

  reset(): void {
    this.state = 'ground';
    this.osc = '';
  }
}
