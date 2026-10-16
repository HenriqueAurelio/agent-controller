import { describe, expect, it } from 'vitest';
import { translate } from '@shared/i18n';
import { DEFAULT_PREFERENCES, sanitizePreferences } from '@shared/prefs';
import {
  assignBinding,
  bindingFromEvent,
  bindingIndex,
  bindingProblem,
  DEFAULT_SHORTCUTS,
  normalizeBinding,
  sanitizeShortcuts,
  SESSION_BINDING,
  SHORTCUT_ACTIONS,
} from '@shared/shortcuts';

const press = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  bindingFromEvent({
    key,
    ctrlKey: mods.ctrl === true,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
  });

describe('bindingFromEvent', () => {
  it('names a key press, with the modifiers in a fixed order', () => {
    expect(press('n', { ctrl: true, shift: true })).toBe('Ctrl+Shift+N');
    expect(press('N', { shift: true, ctrl: true, alt: true })).toBe('Ctrl+Alt+Shift+N');
    expect(press('Tab', { ctrl: true })).toBe('Ctrl+Tab');
    expect(press(',', { ctrl: true })).toBe('Ctrl+,');
    expect(press(' ', { ctrl: true })).toBe('Ctrl+Space');
    expect(press('+', { ctrl: true })).toBe('Ctrl+Plus');
    expect(press('F6')).toBe('F6');
  });

  it('is nothing while only modifiers are down, or the layout has not resolved the key', () => {
    for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Unidentified']) {
      expect(press(key, { ctrl: true })).toBeNull();
    }
  });
});

describe('which bindings are accepted', () => {
  it('refuses what would take keys from typing, from the terminal or from the editor', () => {
    const problem = (binding: string) => {
      const message = bindingProblem(binding);
      return message && translate('pt-BR', message.key, message.params);
    };
    expect(problem('A')).toMatch(/Ctrl, Alt/);
    expect(problem('Shift+A')).toMatch(/Ctrl, Alt/);
    expect(problem('Ctrl+C')).toMatch(/terminal/);
    expect(problem('Ctrl+S')).toMatch(/editor/);
    expect(problem('F12')).not.toBeNull();
    // The changes panel moves with F6, and the list of sessions picks with Ctrl+Space.
    for (const binding of ['F6', 'Shift+F6', 'Ctrl+Space']) expect(problem(binding)).not.toBeNull();
    expect(problem('Ctrl+3')).toMatch(/sessão 3/);
  });

  it('accepts a modifier with a key, and function keys alone', () => {
    for (const binding of ['Ctrl+K', 'Alt+ArrowRight', 'Ctrl+Shift+Tab', 'F7', 'Ctrl+Plus']) {
      expect(bindingProblem(binding), binding).toBeNull();
    }
  });

  it('every default is accepted and belongs to one action only', () => {
    const all = SHORTCUT_ACTIONS.flatMap((action) => DEFAULT_SHORTCUTS[action]);
    for (const binding of all) expect(normalizeBinding(binding), binding).toBe(binding);
    expect(new Set(all).size).toBe(all.length);
    expect(all.some((binding) => SESSION_BINDING.test(binding))).toBe(false);
  });

  it('normalizes what was written by hand', () => {
    expect(normalizeBinding('shift + ctrl + k')).toBe('Ctrl+Shift+K');
    expect(normalizeBinding('Ctrl+Ctrl+K')).toBeNull();
    expect(normalizeBinding('Ctrl+')).toBeNull();
    expect(normalizeBinding('Banana+K')).toBeNull();
    expect(normalizeBinding('Ctrl+Shift')).toBeNull();
    expect(normalizeBinding(42)).toBeNull();
  });
});

describe('sanitizeShortcuts', () => {
  it('falls back to the defaults for anything that is not a map', () => {
    for (const input of [undefined, null, 'x', 3, []]) {
      expect(sanitizeShortcuts(input)).toEqual(DEFAULT_SHORTCUTS);
    }
  });

  it('keeps what the user chose, including "no shortcut", and fills in the rest', () => {
    const result = sanitizeShortcuts({ newSession: ['Ctrl+K'], palette: [], estranho: ['Ctrl+J'] });
    expect(result.newSession).toEqual(['Ctrl+K']);
    expect(result.palette).toEqual([]);
    expect(result.toggleChanges).toEqual(DEFAULT_SHORTCUTS.toggleChanges);
    expect(Object.keys(result).sort()).toEqual([...SHORTCUT_ACTIONS].sort());
  });

  it('drops invalid bindings and never leaves one binding on two actions', () => {
    const result = sanitizeShortcuts({
      newSession: ['Ctrl+C', 'A', 7, 'Ctrl+K', 'Ctrl+K'],
      // Taken by the default of an action that comes first in the list.
      preferences: ['Ctrl+Tab', 'Ctrl+J'],
    });
    expect(result.newSession).toEqual(['Ctrl+K']);
    expect(result.nextSession).toContain('Ctrl+Tab');
    expect(result.preferences).toEqual(['Ctrl+J']);
  });

  it('is part of the preferences, old files included', () => {
    expect(sanitizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES);
    const old = sanitizePreferences({ theme: 'light' });
    expect(old.shortcuts).toEqual(DEFAULT_SHORTCUTS);
    expect(old.showHiddenFiles).toBe(false);
    expect(sanitizePreferences({ showHiddenFiles: true }).showHiddenFiles).toBe(true);
  });
});

describe('assignBinding', () => {
  it('adds a binding to an action', () => {
    const { map, takenFrom } = assignBinding(DEFAULT_SHORTCUTS, 'nextWaiting', 'Ctrl+J');
    expect(takenFrom).toBeNull();
    expect(map.nextWaiting).toEqual(['Ctrl+J']);
    expect(bindingIndex(map).get('Ctrl+J')).toBe('nextWaiting');
  });

  it('moves a binding that another action had', () => {
    const { map, takenFrom } = assignBinding(DEFAULT_SHORTCUTS, 'closeSession', 'Ctrl+Tab');
    expect(takenFrom).toBe('nextSession');
    expect(map.nextSession).toEqual(['Ctrl+PageDown']);
    expect(map.closeSession).toEqual(['Ctrl+Tab']);
    expect(bindingIndex(map).get('Ctrl+Tab')).toBe('closeSession');
    expect(sanitizeShortcuts(map)).toEqual(map);
  });
});
