// The language of the interface. Every text shown to the user is a key of a dictionary; nothing
// outside this folder knows the words.
import { en } from './en';
import { es } from './es';
import { ptBR } from './pt-BR';

export const LANGUAGES = ['pt-BR', 'en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'pt-BR';

/** Each language under its own name: the one who needs the list may not read the current one. */
export const LANGUAGE_NAME: Record<Language, string> = {
  'pt-BR': 'Português (Brasil)',
  en: 'English',
  es: 'Español',
};

export type MessageKey = keyof typeof ptBR;

/** A text still to be worded: what the core hands over, since it does not know the language. */
export interface Message {
  key: MessageKey;
  params?: MessageParams;
}
export type MessageParams = Record<string, string | number | Message>;
export type Translate = (key: MessageKey, params?: MessageParams) => string;

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { 'pt-BR': ptBR, en, es };

export const sanitizeLanguage = (value: unknown): Language =>
  LANGUAGES.includes(value as Language) ? (value as Language) : DEFAULT_LANGUAGE;

/** A `{name}` with no value is left as it is, for whoever fills it in later (see `rich`). */
export function translate(language: Language, key: MessageKey, params?: MessageParams): string {
  const text = DICTIONARIES[language][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'object' ? translate(language, value.key, value.params) : String(value);
  });
}

export const translator =
  (language: Language): Translate =>
  (key, params) =>
    translate(language, key, params);

/**
 * An error whose message is for the user. Thrown anywhere, worded where the language is known:
 * until then it reads in the default language, which is what logs and tests see.
 */
export class UserError extends Error implements Message {
  constructor(
    readonly key: MessageKey,
    readonly params?: MessageParams,
  ) {
    super(translate(DEFAULT_LANGUAGE, key, params));
    this.name = 'UserError';
  }
}

export function errorText(language: Language, err: unknown): string {
  if (err instanceof UserError) return translate(language, err.key, err.params);
  return err instanceof Error ? err.message : String(err);
}
