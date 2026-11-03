import { describe, expect, it } from 'vitest';
import { encodeHeader, sendToPhone } from '../../src/core/notify/phonePush';
import {
  DEFAULT_PHONE_SETTINGS,
  phoneReady,
  randomTopic,
  sanitizePhoneSettings,
  type PhoneSettings,
} from '../../src/shared/phone';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status = 200) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const ntfy: PhoneSettings = {
  ...DEFAULT_PHONE_SETTINGS,
  provider: 'ntfy',
  server: 'https://ntfy.example.com/',
  topic: 'aurelium-abc',
};

describe('sendToPhone', () => {
  it('posts to the topic on ntfy, with the title as a header and the line as the body', async () => {
    const { calls, impl } = fakeFetch();
    const error = await sendToPhone(ntfy, { title: 'API', body: 'Terminou' }, null, impl);
    expect(error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://ntfy.example.com/aurelium-abc');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Title).toBe('API');
    expect(calls[0]!.init.body).toBe('Terminou');
  });

  it('says the status when the server refuses', async () => {
    const { impl } = fakeFetch(403);
    expect(await sendToPhone(ntfy, { title: 'a', body: 'b' }, null, impl)).toBe('ntfy 403');
  });

  it('says the error when the server cannot be reached', async () => {
    const impl = (async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    expect(await sendToPhone(ntfy, { title: 'a', body: 'b' }, null, impl)).toBe('fetch failed');
  });

  it('writes to the chat through the Telegram bot', async () => {
    const { calls, impl } = fakeFetch();
    const settings: PhoneSettings = { ...ntfy, provider: 'telegram', chatId: '12345' };
    const error = await sendToPhone(
      settings,
      { title: 'API', body: 'Aguardando você' },
      'T:K',
      impl,
    );
    expect(error).toBeNull();
    expect(calls[0]!.url).toBe('https://api.telegram.org/botT:K/sendMessage');
    expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
      chat_id: '12345',
      text: 'API\nAguardando você',
    });
  });

  it('sends nothing to Telegram without the token, nor anything when off', async () => {
    const { calls, impl } = fakeFetch();
    const telegram: PhoneSettings = { ...ntfy, provider: 'telegram', chatId: '1' };
    expect(await sendToPhone(telegram, { title: 'a', body: 'b' }, null, impl)).toBe('no token');
    expect(
      await sendToPhone(DEFAULT_PHONE_SETTINGS, { title: 'a', body: 'b' }, 'x', impl),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('encodeHeader', () => {
  it('keeps plain ASCII and encodes the rest as RFC 2047', () => {
    expect(encodeHeader('API: done')).toBe('API: done');
    const encoded = encodeHeader('Aguardando você');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const inner = encoded.slice('=?UTF-8?B?'.length, -2);
    expect(Buffer.from(inner, 'base64').toString('utf8')).toBe('Aguardando você');
  });
});

describe('sanitizePhoneSettings', () => {
  it('falls back to off and the public server on anything odd', () => {
    expect(sanitizePhoneSettings(undefined)).toEqual(DEFAULT_PHONE_SETTINGS);
    expect(
      sanitizePhoneSettings({
        provider: 'pager',
        server: 'ftp://x',
        topic: 'has space',
        chatId: 'abc',
      }),
    ).toEqual(DEFAULT_PHONE_SETTINGS);
  });

  it('keeps what is valid', () => {
    expect(
      sanitizePhoneSettings({
        provider: 'telegram',
        server: 'http://192.168.0.2:8080/',
        topic: ' my_topic-1 ',
        chatId: '-100123',
        onlyWhenAway: false,
      }),
    ).toEqual({
      provider: 'telegram',
      server: 'http://192.168.0.2:8080',
      topic: 'my_topic-1',
      chatId: '-100123',
      onlyWhenAway: false,
    });
    expect(sanitizePhoneSettings({ chatId: '@meu_canal' }).chatId).toBe('@meu_canal');
  });

  it('is ready only with what each provider needs', () => {
    expect(phoneReady(ntfy, false)).toBe(true);
    expect(phoneReady({ ...ntfy, topic: '' }, false)).toBe(false);
    const telegram: PhoneSettings = { ...ntfy, provider: 'telegram', chatId: '1' };
    expect(phoneReady(telegram, false)).toBe(false);
    expect(phoneReady(telegram, true)).toBe(true);
    expect(phoneReady(DEFAULT_PHONE_SETTINGS, true)).toBe(false);
  });
});

describe('randomTopic', () => {
  it('makes a valid topic that is not repeated', () => {
    const a = randomTopic();
    expect(a).toMatch(/^aurelium-[a-z2-9]{20}$/);
    expect(sanitizePhoneSettings({ topic: a }).topic).toBe(a);
    expect(randomTopic()).not.toBe(a);
  });
});
