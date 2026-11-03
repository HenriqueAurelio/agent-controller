// The Sonar setup of each group, without any secret: the token lives in the system's vault, kept by
// the main process (it needs Electron's safeStorage).
import { sanitizeSonarConfig, type SonarConfig } from '@shared/sonar';
import { JsonStore } from '../store/JsonStore';

interface Stored {
  groups: Record<string, SonarConfig>;
}

const GROUP_ID = /^[\w-]{1,64}$/;

function clean(data: unknown): Stored {
  const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const given = raw.groups && typeof raw.groups === 'object' ? raw.groups : {};
  const groups: Record<string, SonarConfig> = {};
  for (const [id, value] of Object.entries(given as Record<string, unknown>)) {
    const config = GROUP_ID.test(id) ? sanitizeSonarConfig(value) : null;
    if (config) groups[id] = config;
  }
  return { groups };
}

export class SonarConfigStore {
  private readonly store: JsonStore<Stored>;
  private data: Stored;

  constructor(file: string) {
    this.store = new JsonStore<Stored>({
      file,
      version: 1,
      migrations: {},
      defaults: () => ({ groups: {} }),
      validate: clean,
    });
    this.data = this.store.load();
  }

  get(groupId: string): SonarConfig | null {
    return this.data.groups[groupId] ?? null;
  }

  set(groupId: string, config: SonarConfig | null): void {
    if (config) this.data.groups[groupId] = config;
    else delete this.data.groups[groupId];
    this.store.save(this.data);
  }
}
