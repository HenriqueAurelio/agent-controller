import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  BUILTIN_CODE_THEMES,
  DEFAULT_CODE_THEME,
  isCustomThemeId,
  type CodeThemeData,
  type CodeThemeInfo,
} from '@shared/codeThemes';
import type { Translate } from '@shared/i18n';
import type { ThemeName } from '@shared/prefs';
import type { CodeThemeRequest } from './diffProtocol';
import { useAppState } from './store';

// The themes the user imported. Asked once, and again after an import or a removal.
let custom: CodeThemeInfo[] = [];
let asked = false;
const listeners = new Set<() => void>();
const data = new Map<string, Promise<CodeThemeData | null>>();

export async function refreshCustomThemes(): Promise<void> {
  asked = true;
  try {
    custom = await window.api.invoke('themes:list');
  } catch {
    custom = [];
  }
  data.clear();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useCustomThemes(): CodeThemeInfo[] {
  useEffect(() => {
    if (!asked) void refreshCustomThemes();
  }, []);
  return useSyncExternalStore(subscribe, () => custom);
}

/** The themes the user can pick for one kind of app theme: the built-in ones, then theirs. */
export const themesOfKind = (kind: ThemeName, imported: readonly CodeThemeInfo[]) =>
  [...BUILTIN_CODE_THEMES, ...imported].filter((theme) => theme.kind === kind);

export const codeThemeName = (t: Translate, theme: CodeThemeInfo): string =>
  theme.id === 'app-dark'
    ? t('codeTheme.app-dark')
    : theme.id === 'app-light'
      ? t('codeTheme.app-light')
      : theme.name;

function themeData(id: string): Promise<CodeThemeData | null> {
  let found = data.get(id);
  if (!found) {
    found = window.api.invoke('themes:get', id).catch(() => null);
    data.set(id, found);
  }
  return found;
}

/**
 * What the diff frame needs to color the code: the theme of the preferences for this kind of
 * app theme, or `id` when given. An imported theme comes with its colors; one that is gone
 * falls back to the theme of the app. Null while those colors are on their way.
 */
export function useCodeTheme(kind: ThemeName, id?: string): CodeThemeRequest | null {
  const preferred = useAppState((s) =>
    kind === 'light' ? s.prefs.codeThemeLight : s.prefs.codeThemeDark,
  );
  const wanted = id ?? preferred;
  const [loaded, setLoaded] = useState<{ id: string; data: CodeThemeData | null } | null>(null);
  // Removing an imported theme empties the cache: ask again.
  const imported = useCustomThemes();

  useEffect(() => {
    if (!isCustomThemeId(wanted)) return;
    let cancelled = false;
    void themeData(wanted).then((found) => !cancelled && setLoaded({ id: wanted, data: found }));
    return () => {
      cancelled = true;
    };
  }, [wanted, imported]);

  const data = loaded?.id === wanted ? loaded.data : undefined;
  // The same object while nothing changes: the panel sends the file again when it changes.
  return useMemo(() => {
    if (!isCustomThemeId(wanted)) return { id: wanted, kind };
    if (data === undefined) return null;
    return data ? { id: wanted, kind, data } : { id: DEFAULT_CODE_THEME[kind], kind };
  }, [wanted, kind, data]);
}
