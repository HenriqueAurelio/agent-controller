import type { ThemeName } from '@shared/prefs';

/** Parent → diff frame. */
export interface ShowDiffMessage {
  type: 'show';
  path: string;
  original: string;
  modified: string;
  inline: boolean;
  theme: ThemeName;
  fontSize: number;
}

/** Diff frame → parent. */
export type FrameMessage =
  | { type: 'ready' }
  /** Keys the app handles globally, pressed while the focus was inside the frame. */
  | { type: 'key'; key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };
