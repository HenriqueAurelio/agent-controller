// The preview of a local page, inside the window (ADR 0031). A view of its own, with no Node, no
// preload and a session apart from the app's: what the page runs cannot reach the app. Only pages
// of this machine load in it; any other address opens in the user's browser.
import fs from 'node:fs';
import path from 'node:path';
import { shell, WebContentsView, type BrowserWindow } from 'electron';
import { isLocalUrl, type PreviewBounds, type PreviewState } from '@shared/preview';

export class Preview {
  private view: WebContentsView | null = null;
  private visible = false;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly onState: (state: PreviewState | null) => void,
  ) {}

  open(url: string, bounds: PreviewBounds): void {
    if (!isLocalUrl(url)) throw new Error('not a local address');
    const window = this.window();
    if (!window) return;
    if (!this.view) {
      const view = new WebContentsView({
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          partition: 'aurelium-preview',
        },
      });
      const contents = view.webContents;
      contents.setWindowOpenHandler(({ url: target }) => {
        if (isLocalUrl(target)) void contents.loadURL(target);
        else void shell.openExternal(target);
        return { action: 'deny' };
      });
      contents.on('will-navigate', (event, target) => {
        if (isLocalUrl(target)) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
      });
      const report = (error?: string) =>
        this.onState({
          url: contents.getURL(),
          title: contents.getTitle(),
          loading: contents.isLoading(),
          canGoBack: contents.navigationHistory.canGoBack(),
          ...(error ? { error } : {}),
        });
      contents.on('did-start-loading', () => report());
      contents.on('did-stop-loading', () => report());
      contents.on('page-title-updated', () => report());
      contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
        if (mainFrame && code !== -3) report(description);
      });
      this.view = view;
    }
    if (!this.visible) {
      window.contentView.addChildView(this.view);
      this.visible = true;
    }
    this.setBounds(bounds);
    if (this.view.webContents.getURL() !== url) void this.view.webContents.loadURL(url);
  }

  setBounds(bounds: PreviewBounds): void {
    if (!this.view) return;
    const round = (n: number) => Math.max(0, Math.round(n));
    this.view.setBounds({
      x: round(bounds.x),
      y: round(bounds.y),
      width: round(bounds.width),
      height: round(bounds.height),
    });
  }

  /** Out of sight (a dialog of the app is over it), kept loaded. */
  hide(): void {
    const window = this.window();
    if (this.view && this.visible && window && !window.isDestroyed()) {
      window.contentView.removeChildView(this.view);
    }
    this.visible = false;
  }

  reload(): void {
    this.view?.webContents.reload();
  }

  back(): void {
    if (this.view?.webContents.navigationHistory.canGoBack()) {
      this.view.webContents.navigationHistory.goBack();
    }
  }

  /** The page as it shows now, as a PNG data URL. */
  async capture(): Promise<string> {
    if (!this.view) throw new Error('no preview');
    const image = await this.view.webContents.capturePage();
    return image.toDataURL();
  }

  close(): void {
    this.hide();
    if (this.view) {
      this.view.webContents.close();
      this.view = null;
    }
    this.onState(null);
  }

  state(): PreviewState | null {
    const contents = this.view?.webContents;
    if (!contents) return null;
    return {
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
    };
  }
}

/** Keeps a marked-up screenshot for the agent to read; returns where it is. */
export async function saveShot(dir: string, sessionId: string, dataUrl: string): Promise<string> {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error('not a PNG');
  const folder = path.join(dir, sessionId.replace(/[^\w-]/g, '_'));
  await fs.promises.mkdir(folder, { recursive: true });
  const file = path.join(folder, `print-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  await fs.promises.writeFile(file, Buffer.from(match[1]!, 'base64'));
  return file;
}
