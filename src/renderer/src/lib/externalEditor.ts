import type { EditorOpenInput } from '@shared/editor';
import { errorMessage } from './format';
import { store } from './store';

const SETUP_EVENT = 'agent-controller:editor-setup';
const ERROR_EVENT = 'agent-controller:editor-error';
const OPEN_FILE_EVENT = 'agent-controller:editor-open-file';

/**
 * Opens the folder of the session, or a file of it, in the external editor. With no editor picked
 * it asks the app to show the preferences instead, and a failure goes to the app as a message.
 */
export async function openInEditor(sessionId: string, input: EditorOpenInput = {}): Promise<void> {
  if (!store.get().prefs.externalEditor.editor) {
    window.dispatchEvent(new CustomEvent(SETUP_EVENT));
    return;
  }
  try {
    await window.api.invoke('editor:open', sessionId, input);
  } catch (err) {
    window.dispatchEvent(new CustomEvent<string>(ERROR_EVENT, { detail: errorMessage(err) }));
  }
}

const listen = <T>(name: string, listener: (detail: T) => void): (() => void) => {
  const handler = (event: Event) => listener((event as CustomEvent<T>).detail);
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
};

export const onEditorSetup = (listener: () => void) => listen<void>(SETUP_EVENT, listener);
export const onEditorError = (listener: (message: string) => void) =>
  listen<string>(ERROR_EVENT, listener);

/** The panel answers this by opening its file at the cursor; `handled` tells whether it did. */
export interface OpenFileRequest {
  handled: boolean;
}

/** Asks an open file of the panel to go to the editor; false when no file is open. */
export function requestOpenPanelFile(): boolean {
  const detail: OpenFileRequest = { handled: false };
  window.dispatchEvent(new CustomEvent<OpenFileRequest>(OPEN_FILE_EVENT, { detail }));
  return detail.handled;
}

export const onOpenPanelFile = (listener: (request: OpenFileRequest) => void) =>
  listen<OpenFileRequest>(OPEN_FILE_EVENT, listener);
