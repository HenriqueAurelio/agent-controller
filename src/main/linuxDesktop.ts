// The app as an installed application on Linux: started from a terminal, it lets go of it; run
// from an AppImage, it puts itself in the menu of applications with its icon.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, nativeImage } from 'electron';
import { DETACHED_ENV, desktopEntry, detachTarget } from '@core/desktop/linuxDesktop';
import { translate, type Language } from '@shared/i18n';

/** The name of the entry and of the icon; the same `desktopName` of package.json. */
const DESKTOP_ID = 'aurelium';

/**
 * Started from a terminal, starts a copy of the app on its own (a session of its own, no
 * terminal) and tells the caller to end this one. The terminal is free at once, and closing it
 * no longer ends the app.
 */
export function detachFromTerminal(): boolean {
  const target = detachTarget({
    platform: process.platform,
    packaged: app.isPackaged,
    stdoutIsTTY: process.stdout.isTTY === true,
    env: process.env,
    argv: process.argv,
    execPath: process.execPath,
  });
  if (!target) return false;
  try {
    const child = spawn(target.file, target.args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [DETACHED_ENV]: '1' },
    });
    child.unref();
    return true;
  } catch {
    // Better attached to the terminal than not open at all.
    return false;
  }
}

/** Writes the file when its content changed; false when it could not. */
function writeIfChanged(file: string, content: string | Buffer): void {
  try {
    if (fs.readFileSync(file).equals(Buffer.from(content))) return;
  } catch {
    // Not there yet.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * Run from an AppImage, the app enters the menu of applications of the user, with its icon, on
 * every start: a moved AppImage gets its entry pointed to where it is now.
 */
export function registerAppImage(logo: string, language: Language): void {
  const appImage = process.env.APPIMAGE;
  if (process.platform !== 'linux' || !appImage) return;
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  try {
    const icon = nativeImage.createFromPath(logo).resize({ width: 256, height: 256 });
    if (!icon.isEmpty()) {
      writeIfChanged(
        path.join(dataHome, 'icons', 'hicolor', '256x256', 'apps', `${DESKTOP_ID}.png`),
        icon.toPNG(),
      );
    }
    writeIfChanged(
      path.join(dataHome, 'applications', `${DESKTOP_ID}.desktop`),
      desktopEntry({
        name: 'Aurelium',
        comment: translate(language, 'desktop.comment'),
        exec: appImage,
        icon: DESKTOP_ID,
        wmClass: DESKTOP_ID,
      }),
    );
  } catch {
    // Without the entry the app still works; it is only missing from the menu.
  }
}
