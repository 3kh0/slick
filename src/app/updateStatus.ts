import type { ChangelogRelease } from '../shared/changelog.ts';

export type UpdateStatus = {
  state: 'idle' | 'available' | 'downloading' | 'ready' | 'error';
  latestBuild?: number;
  title?: string;
  detail?: string;
  percent?: number;
  /** A code-only update needs no new app download. */
  kind?: 'code' | 'full';
  size?: number;
  notes?: ChangelogRelease[];
};
