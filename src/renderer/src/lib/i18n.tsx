import { Fragment, useMemo, type ReactNode } from 'react';
import { translator, type Translate } from '@shared/i18n';
import { useAppState } from './store';

/** The texts in the language of the preferences; changing it redraws whoever uses this. */
export function useT(): Translate {
  const language = useAppState((s) => s.prefs.language);
  return useMemo(() => translator(language), [language]);
}

/**
 * A translated text with elements in the place of some of its `{name}` marks: the sentence stays
 * whole in the dictionary, whatever the order of its words in each language.
 */
export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? <Fragment key={index}>{nodes[name]}</Fragment> : part;
  });
}
