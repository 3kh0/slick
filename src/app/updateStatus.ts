export type UpdateStatus = {
  state: 'idle' | 'available' | 'downloading' | 'ready' | 'error';
  latestBuild?: number;
  title?: string;
  detail?: string;
  percent?: number;
};
