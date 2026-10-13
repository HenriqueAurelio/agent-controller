import type { AgentProfileId } from './session';

export type AgentAvailabilityStatus = 'ok' | 'missing' | 'outdated' | 'newer-than-tested';

export interface AgentAvailability {
  profile: AgentProfileId;
  displayName: string;
  status: AgentAvailabilityStatus;
  /** Only `missing` blocks the creation of a session. */
  usable: boolean;
  path?: string;
  version?: string;
  minVersion: string;
  lastTestedVersion: string;
  /** Explanation shown in the new-session dialog when status is not `ok`. */
  message?: string;
}
