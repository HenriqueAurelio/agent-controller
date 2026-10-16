import type { ThemeName } from '@shared/prefs';

/** Parent → diff frame. */
export type ParentMessage =
  | {
      type: 'show';
      path: string;
      original: string;
      modified: string;
      /** False for a removed file: there is nothing in the working tree to edit. */
      editable: boolean;
      inline: boolean;
      theme: ThemeName;
      fontSize: number;
      /** Replace the editor's content even if it has unsaved edits. */
      discardEdits?: boolean;
    }
  /** Another file is being loaded: nothing typed now would belong to it. */
  | { type: 'loading' }
  /** The shortcuts of the app, which the frame hands back instead of keeping. */
  | { type: 'shortcuts'; bindings: string[] }
  /** Ask the frame for its current content, to save it. */
  | { type: 'request-save'; overwrite: boolean }
  /** The content was written to disk: it is the new starting point. */
  | { type: 'saved'; path: string; content: string }
  /** Ask the frame for the text selected in the editor. */
  | { type: 'request-selection' };

/** Diff frame → parent. */
export type FrameMessage =
  | { type: 'ready' }
  | { type: 'dirty'; path: string; dirty: boolean }
  /** `expected` is what the editor loaded from disk; null means "overwrite whatever is there". */
  | { type: 'save'; path: string; content: string; expected: string | null }
  /** The menu of the editor was asked for, at a point of the frame, over this selection. */
  | { type: 'contextmenu'; x: number; y: number; selection: string }
  /** The answer to `request-selection`. */
  | { type: 'selection'; selection: string }
  /** Keys the app handles globally, pressed while the focus was inside the frame. */
  | {
      type: 'key';
      key: string;
      ctrlKey: boolean;
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    };
