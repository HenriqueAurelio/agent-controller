import fs from 'node:fs';
import path from 'node:path';
import {
  CUSTOM_THEMES_LIMIT,
  customThemeId,
  isCustomThemeId,
  parseCodeThemeFile,
  sanitizeCodeTheme,
  type CodeThemeData,
  type CodeThemeInfo,
} from '@shared/codeThemes';
import { UserError } from '@shared/i18n';

/**
 * The color themes the user imported, one JSON file each in a folder of the app's data. They
 * stay out of the preferences: a theme can be hundreds of kilobytes, and the preferences go to
 * the window at every change.
 */
export class CodeThemeStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!isCustomThemeId(id)) throw new UserError('error.theme.notFound');
    return path.join(this.dir, `${id}.json`);
  }

  private read(id: string): CodeThemeData | null {
    try {
      return sanitizeCodeTheme(JSON.parse(fs.readFileSync(this.file(id), 'utf8')));
    } catch {
      return null;
    }
  }

  list(): CodeThemeInfo[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    const themes: CodeThemeInfo[] = [];
    const ids = names.map((name) => (name.endsWith('.json') ? name.slice(0, -'.json'.length) : ''));
    for (const id of ids.sort()) {
      const data = isCustomThemeId(id) ? this.read(id) : null;
      if (data) themes.push({ id, name: data.name, kind: data.type, custom: true });
    }
    return themes;
  }

  get(id: string): CodeThemeData | null {
    return isCustomThemeId(id) ? this.read(id) : null;
  }

  /** Validates the text of a theme file and keeps a clean copy of it. */
  import(text: string): CodeThemeInfo {
    const data = parseCodeThemeFile(text);
    const taken = this.list();
    if (taken.length >= CUSTOM_THEMES_LIMIT) throw new UserError('error.theme.tooMany');
    const id = customThemeId(
      data.name,
      taken.map((t) => t.id),
    );
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(id), JSON.stringify(data), 'utf8');
    return { id, name: data.name, kind: data.type, custom: true };
  }

  remove(id: string): void {
    fs.rmSync(this.file(id), { force: true });
  }
}
