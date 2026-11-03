// The preview inside the app (ADR 0031): a page of a local server the session started, shown over
// the place of the terminal, and screenshots of it marked up for the agent.

/** Where the preview sits, in CSS pixels of the window. */
export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  /** Why the page could not load, as the browser said it. */
  error?: string;
}

/** Only pages of this machine: the preview is for what the session serves, not for browsing. */
export function isLocalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** `3000`, `localhost:3000` or a whole address, as an address. */
export function previewAddress(input: string): string | null {
  const text = input.trim();
  if (/^\d{1,5}$/.test(text)) return `http://localhost:${text}`;
  const candidate = /^[a-z]+:\/\//i.test(text) ? text : `http://${text}`;
  return isLocalUrl(candidate) ? new URL(candidate).toString() : null;
}

/** A screenshot sent to the agent is kept at most this big (a PNG as a data URL). */
export const SHOT_LIMIT = 15 * 1024 * 1024;
