import path from 'node:path';
import { app, BrowserWindow, screen, session } from 'electron';
import type { WindowState } from '@core/store/appStore';

function isOnScreen(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false;
  return screen.getAllDisplays().some(({ workArea }) => {
    return (
      state.x! < workArea.x + workArea.width - 80 &&
      state.x! + state.width > workArea.x + 80 &&
      state.y! >= workArea.y - 10 &&
      state.y! < workArea.y + workArea.height - 80
    );
  });
}

export function saveWindowState(window: BrowserWindow, state: WindowState): void {
  state.maximized = window.isMaximized();
  if (!state.maximized && !window.isMinimized() && !window.isFullScreen()) {
    Object.assign(state, window.getBounds());
  }
}

function isAppUrl(url: string): boolean {
  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer && !app.isPackaged) return url.startsWith(devServer);
  return url.startsWith('file://');
}

export function createMainWindow(state: WindowState): BrowserWindow {
  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(isOnScreen(state) ? { x: state.x, y: state.y } : {}),
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: '#16181d',
    title: 'Agent Controller',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  // No menu bar at all: on Linux a hidden one still takes the Alt key away from the page.
  window.removeMenu();
  if (state.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) {
    window.on(event as 'resize', () => saveWindowState(window, state));
  }

  // The app shows only its own page: no navigation, no new windows, no remote content.
  const { webContents } = window;
  webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  // Links in the terminal are opened through the `shell:openExternal` command, on a click;
  // nothing in the page gets to open a window, here or in the browser.
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  webContents.on('will-attach-webview', (event) => event.preventDefault());
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  if (!app.isPackaged) {
    webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') webContents.toggleDevTools();
    });
  }

  const devServer = process.env.ELECTRON_RENDERER_URL;
  if (devServer && !app.isPackaged) void window.loadURL(devServer);
  else void window.loadFile(path.join(app.getAppPath(), 'out', 'renderer', 'index.html'));
  return window;
}
