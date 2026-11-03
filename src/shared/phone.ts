// The notices of the app on the user's phone (ADR 0033). The settings travel with the preferences;
// the token of a Telegram bot does not: it is kept in the system's vault.

export type PhoneProvider = 'off' | 'ntfy' | 'telegram';

export interface PhoneSettings {
  provider: PhoneProvider;
  /** ntfy: the server, `https://ntfy.sh` or the user's own. */
  server: string;
  /** ntfy: the topic; whoever knows it reads the notices, so it should be hard to guess. */
  topic: string;
  /** Telegram: the chat the bot writes to. */
  chatId: string;
  /** Only while the window of the app is not in focus: at the desk, the system notice is enough. */
  onlyWhenAway: boolean;
}

export const NTFY_SERVER = 'https://ntfy.sh';

export const DEFAULT_PHONE_SETTINGS: PhoneSettings = {
  provider: 'off',
  server: NTFY_SERVER,
  topic: '',
  chatId: '',
  onlyWhenAway: true,
};

const TOPIC = /^[\w-]{1,64}$/;
const CHAT = /^-?\d{1,20}$|^@[\w]{4,40}$/;

export function sanitizePhoneSettings(value: unknown): PhoneSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const provider: PhoneProvider =
    v.provider === 'ntfy' || v.provider === 'telegram' ? v.provider : 'off';
  let server = NTFY_SERVER;
  if (typeof v.server === 'string' && v.server.trim()) {
    try {
      const url = new URL(v.server.trim());
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        server = url.toString().replace(/\/+$/, '');
      }
    } catch {
      // Not an address: the public server.
    }
  }
  const topic = typeof v.topic === 'string' && TOPIC.test(v.topic.trim()) ? v.topic.trim() : '';
  const chatId = typeof v.chatId === 'string' && CHAT.test(v.chatId.trim()) ? v.chatId.trim() : '';
  return { provider, server, topic, chatId, onlyWhenAway: v.onlyWhenAway !== false };
}

/** Whether the settings are enough to send anything. */
export function phoneReady(settings: PhoneSettings, hasToken: boolean): boolean {
  if (settings.provider === 'ntfy') return Boolean(settings.topic);
  if (settings.provider === 'telegram') return Boolean(settings.chatId) && hasToken;
  return false;
}

/**
 * A topic nobody guesses: `aurelium-` and 20 random letters and digits, from the cryptographic
 * source (the topic is all that protects the notices on a public server).
 */
export function randomTopic(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
  return `aurelium-${Array.from(bytes, (b) => letters[b % letters.length]).join('')}`;
}
