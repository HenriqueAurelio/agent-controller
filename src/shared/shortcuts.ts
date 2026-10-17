// Keyboard shortcuts of the app: what can be bound, the defaults, and how a key press is named.
// A binding is a string such as `Ctrl+Shift+N`: modifiers in a fixed order, then the key.
import type { Message } from './i18n';

export const SHORTCUT_ACTIONS = [
  'newSession',
  'nextSession',
  'prevSession',
  'nextWaiting',
  'closeSession',
  'focusSidebar',
  'focusTerminal',
  'palette',
  'quickOpen',
  'overview',
  'board',
  'toggleChanges',
  'toggleFiles',
  'toggleHidden',
  'toggleAux',
  'sendPrompt',
  'allowPermission',
  'denyPermission',
  'newGroup',
  'preferences',
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type ShortcutMap = Record<ShortcutAction, string[]>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  newSession: ['Ctrl+Shift+N'],
  nextSession: ['Ctrl+Tab', 'Ctrl+PageDown'],
  prevSession: ['Ctrl+Shift+Tab', 'Ctrl+PageUp'],
  nextWaiting: [],
  closeSession: [],
  focusSidebar: ['Ctrl+0'],
  focusTerminal: ['Ctrl+Shift+T'],
  palette: ['Ctrl+Shift+P'],
  // In a terminal it is the key of the shell's history, so it only works there if the preference says so.
  quickOpen: ['Ctrl+P'],
  overview: ['Ctrl+Shift+O'],
  board: ['Ctrl+Shift+B'],
  toggleChanges: ['Ctrl+Shift+G'],
  toggleFiles: ['Ctrl+Shift+E'],
  toggleHidden: ['Ctrl+Shift+H'],
  // Shift+' gives `"` on the US and ABNT2 layouts; the other is for those where it does not.
  toggleAux: ['Ctrl+Shift+"', "Ctrl+Shift+'"],
  sendPrompt: ['Ctrl+Shift+M'],
  // Only taken while the session in sight asks a permission; otherwise they reach the terminal.
  allowPermission: ['Alt+Y'],
  denyPermission: ['Alt+N'],
  newGroup: [],
  preferences: ['Ctrl+,'],
};

export const MAX_BINDINGS_PER_ACTION = 4;

/** `Ctrl+1` … `Ctrl+9` go to the session in that position. They are not configurable. */
export const SESSION_BINDING = /^Ctrl\+([1-9])$/;

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

// Keys that are not a shortcut by themselves, or that the keyboard layout has not resolved yet.
const NOT_A_KEY = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Dead',
  'Process',
  'Unidentified',
  'OS',
]);

// What the terminal and the editor of the changes panel need for themselves, and the keys that
// move around the panel (F6) and pick sessions in the list (Ctrl+Space).
const RESERVED = new Set([
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+Shift+C',
  'Ctrl+Shift+V',
  'Ctrl+S',
  'F2',
  'F12',
  'F6',
  'Shift+F6',
  'Ctrl+Space',
]);

export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

function keyName(key: string): string | null {
  if (!key || NOT_A_KEY.has(key)) return null;
  if (key === ' ') return 'Space';
  if (key === '+') return 'Plus';
  return key.length === 1 ? key.toUpperCase() : key;
}

function format(modifiers: ReadonlySet<Modifier>, key: string): string {
  return [...MODIFIERS.filter((m) => modifiers.has(m)), key].join('+');
}

/** The binding a key press stands for, or null when only modifiers are down. */
export function bindingFromEvent(event: KeyPress): string | null {
  const key = keyName(event.key);
  if (!key) return null;
  const modifiers = new Set<Modifier>();
  if (event.ctrlKey) modifiers.add('Ctrl');
  if (event.altKey) modifiers.add('Alt');
  if (event.shiftKey) modifiers.add('Shift');
  if (event.metaKey) modifiers.add('Meta');
  return format(modifiers, key);
}

/** Why a binding cannot be used, to be worded for the user; null when it can. */
export function bindingProblem(binding: string): Message | null {
  const parts = binding.split('+');
  const key = parts[parts.length - 1]!;
  const modifiers = parts.slice(0, -1);
  if (RESERVED.has(binding)) return { key: 'shortcuts.reserved', params: { binding } };
  if (SESSION_BINDING.test(binding)) {
    return { key: 'shortcuts.sessionBinding', params: { binding, position: key } };
  }
  const functionKey = /^F\d{1,2}$/.test(key);
  const strong = modifiers.some((m) => m === 'Ctrl' || m === 'Alt' || m === 'Meta');
  // Anything else would take a key away from what is typed into the terminal.
  if (!strong && !functionKey) return { key: 'shortcuts.needsModifier' };
  return null;
}

/** The canonical form of a binding written by hand or read from disk; null when it is not one. */
export function normalizeBinding(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > 40) return null;
  const parts = text.split('+').map((p) => p.trim());
  const rawKey = parts.pop();
  if (!rawKey) return null;
  const modifiers = new Set<Modifier>();
  for (const part of parts) {
    const modifier = MODIFIERS.find((m) => m.toLowerCase() === part.toLowerCase());
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  const key = keyName(rawKey);
  if (!key || MODIFIERS.some((m) => m === key)) return null;
  const binding = format(modifiers, key);
  return bindingProblem(binding) ? null : binding;
}

/**
 * A complete, valid map: defaults for actions that are missing, an empty list kept as "no
 * shortcut", and no binding on two actions (the first one, in the order of the list, keeps it).
 */
export function sanitizeShortcuts(input: unknown): ShortcutMap {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const taken = new Set<string>();
  const result = {} as ShortcutMap;
  for (const action of SHORTCUT_ACTIONS) {
    const wanted = Array.isArray(source[action]) ? source[action] : DEFAULT_SHORTCUTS[action];
    const bindings: string[] = [];
    for (const item of wanted) {
      const binding = normalizeBinding(item);
      if (!binding || taken.has(binding) || bindings.length >= MAX_BINDINGS_PER_ACTION) continue;
      taken.add(binding);
      bindings.push(binding);
    }
    result[action] = bindings;
  }
  return result;
}

/** Gives `binding` to `action`, taking it from whichever action had it. */
export function assignBinding(
  map: ShortcutMap,
  action: ShortcutAction,
  binding: string,
): { map: ShortcutMap; takenFrom: ShortcutAction | null } {
  let takenFrom: ShortcutAction | null = null;
  const next = {} as ShortcutMap;
  for (const other of SHORTCUT_ACTIONS) {
    if (other !== action && map[other].includes(binding)) takenFrom = other;
    next[other] = map[other].filter((b) => b !== binding);
  }
  next[action] = [...next[action], binding].slice(-MAX_BINDINGS_PER_ACTION);
  return { map: next, takenFrom };
}

/** Binding → action, for looking a key press up. */
export function bindingIndex(map: ShortcutMap): Map<string, ShortcutAction> {
  const index = new Map<string, ShortcutAction>();
  for (const action of SHORTCUT_ACTIONS) {
    for (const binding of map[action]) if (!index.has(binding)) index.set(binding, action);
  }
  return index;
}
