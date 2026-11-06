export type Branding = { title?: string; thumbTime?: number };
export type Replace = 'all' | 'titles' | 'thumbnails';

type Submission = { title?: unknown; timestamp?: unknown; original?: unknown; votes?: unknown };

export const VIDEO_ID = /^[\w-]{11}$/;

export function videoIdOf(url: string | undefined): string | null {
  const match = url?.match(
    /^https?:\/\/(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})(?![\w-])/,
  );
  return match?.[1] ?? null;
}

const counts = (submission: Submission | undefined): submission is Submission =>
  typeof submission?.votes === 'number' && submission.votes >= 0 && !submission.original;

export function brandingOf(response: unknown): Branding | null {
  const { titles, thumbnails } = (response ?? {}) as { titles?: Submission[]; thumbnails?: Submission[] };
  const branding: Branding = {};
  const title = Array.isArray(titles) ? titles[0] : undefined;
  if (counts(title) && typeof title.title === 'string' && title.title.trim()) {
    branding.title = title.title.replace(/(^|\s)>(\S)/g, '$1$2');
  }
  const thumbnail = Array.isArray(thumbnails) ? thumbnails[0] : undefined;
  if (counts(thumbnail) && typeof thumbnail.timestamp === 'number') branding.thumbTime = thumbnail.timestamp;
  return branding.title !== undefined || branding.thumbTime !== undefined ? branding : null;
}

export const thumbnailUrl = (videoId: string, time: number) =>
  `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoId}&time=${time}`;

export function replacements(videoId: string, branding: Branding | null, replace: Replace) {
  return {
    title: replace !== 'thumbnails' ? branding?.title : undefined,
    thumbUrl:
      replace !== 'titles' && branding?.thumbTime !== undefined ? thumbnailUrl(videoId, branding.thumbTime) : undefined,
  };
}
