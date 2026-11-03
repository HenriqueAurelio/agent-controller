// The notices of the app on the user's phone (ADR 0033): through ntfy (their server or ntfy.sh, on
// a topic of theirs) or a Telegram bot of theirs. Only the title and the short line of a notice go:
// never what the terminal shows.
import type { PhoneSettings } from '@shared/phone';

type Fetch = typeof fetch;

export interface PhoneNotice {
  title: string;
  body: string;
}

const TIMEOUT_MS = 10_000;

/** Sends one notice; resolves with the error as words, or null when it went. */
export async function sendToPhone(
  settings: PhoneSettings,
  notice: PhoneNotice,
  token: string | null,
  fetchImpl: Fetch = fetch,
): Promise<string | null> {
  try {
    if (settings.provider === 'ntfy') {
      const url = `${settings.server.replace(/\/+$/, '')}/${encodeURIComponent(settings.topic)}`;
      const response = await fetchImpl(url, {
        method: 'POST',
        // The title goes as a header: ntfy asks for it to be plain ASCII or RFC 2047; the body
        // keeps every letter.
        headers: { Title: encodeHeader(notice.title), Tags: 'robot' },
        body: notice.body || notice.title,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok ? null : `ntfy ${response.status}`;
    }
    if (settings.provider === 'telegram') {
      if (!token) return 'no token';
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.chatId,
          text: notice.body ? `${notice.title}\n${notice.body}` : notice.title,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok ? null : `Telegram ${response.status}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** RFC 2047 for a header with letters out of ASCII (`Aguardando você`). */
export function encodeHeader(text: string): string {
  // Printable ASCII, from the space to the tilde.
  if (/^[ -~]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}
