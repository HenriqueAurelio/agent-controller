import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  errorText,
  LANGUAGE_NAME,
  LANGUAGES,
  sanitizeLanguage,
  translate,
  translator,
  UserError,
  type MessageKey,
} from '@shared/i18n';
import { en } from '@shared/i18n/en';
import { ptBR } from '@shared/i18n/pt-BR';
import { sanitizePreferences } from '@shared/prefs';
import { STATUS_DETAIL, statusDetail, statusLabel, type SessionStatus } from '@shared/session';

const DICTIONARIES = { 'pt-BR': ptBR, en } as const;
const marks = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionaries', () => {
  it('there is one for each language, and each language has a name', () => {
    expect(Object.keys(DICTIONARIES).sort()).toEqual([...LANGUAGES].sort());
    for (const language of LANGUAGES) expect(LANGUAGE_NAME[language]).toBeTruthy();
  });

  it('every language says every text, with the same values to fill in', () => {
    const keys = Object.keys(ptBR) as MessageKey[];
    for (const language of LANGUAGES) {
      const dictionary: Record<string, string> = DICTIONARIES[language];
      expect(Object.keys(dictionary).sort(), language).toEqual([...keys].sort());
      for (const key of keys) {
        expect(dictionary[key]!.trim(), `${language}: ${key}`).not.toBe('');
        expect(marks(dictionary[key]!), `${language}: ${key}`).toEqual(marks(ptBR[key]));
      }
    }
  });
});

describe('translate', () => {
  it('fills the values in, in the language asked for', () => {
    expect(translate('pt-BR', 'command.goTo', { name: 'API' })).toBe('Ir para: API');
    expect(translate('en', 'command.goTo', { name: 'API' })).toBe('Go to: API');
    expect(translator('en')('notice.exited', { code: 7 })).toBe('The agent exited (code 7).');
  });

  it('words a value that is itself a text, and leaves alone what has no value', () => {
    expect(translate('en', 'error.invalidArgument', { name: { key: 'arg.folder' } })).toBe(
      'Invalid argument: folder',
    );
    expect(translate('en', 'app.closeSession.body')).toContain('{name}');
    // A value is never read again as a text with marks of its own.
    expect(translate('en', 'command.goTo', { name: '{name}' })).toBe('Go to: {name}');
  });

  it('an unknown language is the default one', () => {
    expect(sanitizeLanguage('en')).toBe('en');
    expect(sanitizeLanguage('fr')).toBe(DEFAULT_LANGUAGE);
    expect(sanitizeLanguage(undefined)).toBe(DEFAULT_LANGUAGE);
    expect(sanitizePreferences({ language: 'xx' as never }).language).toBe(DEFAULT_LANGUAGE);
    expect(sanitizePreferences({ language: 'en' }).language).toBe('en');
  });
});

describe('UserError', () => {
  it('reads in the default language until someone who knows the language words it', () => {
    const error = new UserError('error.folder.missing', { folder: '/x' });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('A pasta não existe: /x');
    expect(errorText('en', error)).toBe('The folder does not exist: /x');
    expect(errorText('en', new Error('ENOENT'))).toBe('ENOENT');
    expect(errorText('en', 'texto')).toBe('texto');
  });
});

describe('session status', () => {
  const status = (extra: Partial<SessionStatus>): SessionStatus => ({
    state: 'aguardando',
    origin: 'hook',
    confirmed: true,
    since: 0,
    ...extra,
  });

  it('is worded in each language, "possibly" included', () => {
    expect(statusLabel(translator('pt-BR'), status({}))).toBe('Aguardando você');
    expect(statusLabel(translator('en'), status({}))).toBe('Waiting for you');
    expect(statusLabel(translator('en'), status({ confirmed: false }))).toBe(
      'Possibly waiting for you',
    );
  });

  it('words the details of the app, and shows the others as they came', () => {
    const t = translator('en');
    expect(statusDetail(t, STATUS_DETAIL.ready)).toBe('ready');
    expect(statusDetail(t, STATUS_DETAIL.idle)).toBe('idle, waiting for you');
    expect(statusDetail(translator('pt-BR'), STATUS_DETAIL.unconfirmed)).toBe(
      'sem confirmação do agente',
    );
    expect(statusDetail(t, 'Bash')).toBe('Bash');
    expect(statusDetail(t, undefined)).toBeUndefined();
  });
});
