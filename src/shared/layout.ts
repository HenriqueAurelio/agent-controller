export const SIDES = ['left', 'right', 'top', 'bottom'] as const;
export type Side = (typeof SIDES)[number];

/** `cover`: the panel takes the whole area of the terminal while it is open. */
export const PANEL_PLACES = ['cover', ...SIDES] as const;
export type PanelPlace = (typeof PANEL_PLACES)[number];

/** Where each part of the window goes. */
export interface Layout {
  /** The list of sessions, around everything else. */
  sessions: Side;
  /** The panel of changes and files, in relation to the terminal. */
  panel: PanelPlace;
  /** The list of files inside the panel, in relation to the text of the open file. */
  files: Side;
}

export const DEFAULT_LAYOUT: Layout = { sessions: 'left', panel: 'cover', files: 'left' };

export const isHorizontal = (side: Side): boolean => side === 'top' || side === 'bottom';

export function sanitizeLayout(input: unknown): Layout {
  const layout = (input && typeof input === 'object' ? input : {}) as Partial<Layout>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;
  return {
    sessions: pick(layout.sessions, SIDES, DEFAULT_LAYOUT.sessions),
    panel: pick(layout.panel, PANEL_PLACES, DEFAULT_LAYOUT.panel),
    files: pick(layout.files, SIDES, DEFAULT_LAYOUT.files),
  };
}
