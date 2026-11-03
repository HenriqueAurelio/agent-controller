// The Sonar token of each group, encrypted by the system (Electron's safeStorage: DPAPI on Windows,
// libsecret or kwallet on Linux). Nothing is saved when the system cannot keep a secret: a token
// in plain text on disk is what the plan rules out.
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

const GROUP_ID = /^[\w-]{1,64}$/;

export class SonarTokens {
  private tokens: Record<string, string> = {};

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
      if (raw && typeof raw === 'object') {
        for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
          if (GROUP_ID.test(id) && typeof value === 'string') this.tokens[id] = value;
        }
      }
    } catch {
      // No file yet, or a broken one: no tokens.
    }
  }

  /**
   * Whether a token can be kept. On Linux without a keyring, Electron falls back to a fixed
   * password ("basic_text"), which is no protection: that counts as not available.
   */
  available(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend?.();
      if (backend === 'basic_text' || backend === 'unknown') return false;
    }
    return true;
  }

  has(groupId: string): boolean {
    return groupId in this.tokens;
  }

  get(groupId: string): string | null {
    const stored = this.tokens[groupId];
    if (!stored || !this.available()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'));
    } catch {
      return null;
    }
  }

  /** `null` removes it. */
  set(groupId: string, token: string | null): void {
    if (token === null) delete this.tokens[groupId];
    else this.tokens[groupId] = safeStorage.encryptString(token).toString('base64');
    this.save();
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.tokens), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
