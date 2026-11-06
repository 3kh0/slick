export interface PreviewSelection {
  channelId: string;
  muted: boolean;
  cameraOn: boolean;
  audioInputId?: string;
  audioOutputId?: string;
  cameraInputId?: string;
}

export function readPreviewSelection(channelId: string, doc: Document | undefined, devices: unknown): PreviewSelection {
  const lists = devices as Record<string, { id?: unknown }[] | undefined> | undefined;
  const id = (kind: string) => {
    const value = lists?.[kind]?.[0]?.id;
    return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined;
  };
  return {
    channelId,
    muted: doc?.querySelector('[data-qa="huddle_join_preview_mic_button"]')?.getAttribute('aria-checked') !== 'true',
    cameraOn: doc?.querySelector('[data-qa="huddle_camera_huddle_toolbar"]')?.getAttribute('aria-checked') === 'true',
    audioInputId: id('microphone'),
    audioOutputId: id('output'),
    cameraInputId: id('camera'),
  };
}
