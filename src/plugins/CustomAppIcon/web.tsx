import type { ImportResult, Theme } from './icons.ts';
import black from './icons/tab/black.svg';
import pride from './icons/tab/pride.svg';
import white from './icons/tab/white.svg';

export const TAB_ICONS: Record<string, Record<Theme, string>> = {
  slick: { light: black, dark: white },
  pride: { light: pride, dark: pride },
};
export const TAB_ALIASES: Record<string, string> = { inverted: 'slick', 'pride-inverted': 'pride' };

const SIZE = 128;

export const browserTheme = (): Theme => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function onBrowserTheme(callback: (theme: Theme) => void, signal: AbortSignal) {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => callback(browserTheme()), { signal });
}

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = element.height = SIZE;
  return [element, element.getContext('2d')!];
}

type Drawable = CanvasImageSource & { width: number; height: number };

async function decode(source: string): Promise<Drawable> {
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}

function contain(context: CanvasRenderingContext2D, image: Drawable) {
  const scale = Math.min(SIZE / image.width, SIZE / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
}

export type Badge = { dim: boolean; dot: boolean };

const badged = new Map<string, Promise<string>>();

export function badge(source: string, { dim, dot }: Badge): Promise<string> {
  if (!dim && !dot) return Promise.resolve(source);
  const key = `${dim}:${dot}:${source}`;
  let result = badged.get(key);
  if (!result) {
    result = decode(source).then((image) => {
      const [element, context] = canvas();
      context.globalAlpha = dim ? 0.5 : 1;
      contain(context, image);
      if (dot) {
        const r = SIZE * 0.22;
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'destination-out';
        context.beginPath();
        context.arc(SIZE - r, r, r + SIZE * 0.06, 0, Math.PI * 2);
        context.fill();
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = '#e01e5a';
        context.beginPath();
        context.arc(SIZE - r, r, r, 0, Math.PI * 2);
        context.fill();
      }
      return element.toDataURL('image/png');
    });
    result.catch(() => badged.delete(key));
    badged.set(key, result);
  }
  return result;
}

export const clearBadges = () => badged.clear();

type State = { connectivity?: { clientOnline?: boolean; serviceOnline?: boolean }; unreadCounts?: any };

type Highlights = (state: State) => number;
const isHighlights = (value: unknown): value is Highlights =>
  typeof value === 'function' && value.name === 'getTotalUnreadHighlights';

export function faviconState(getExport: (matcher: typeof isHighlights) => Highlights | undefined) {
  let highlights: Highlights | null | undefined;
  return (state: State): string => {
    if (highlights === undefined) highlights = getExport(isHighlights) ?? null;
    const online = !state?.connectivity || (!!state.connectivity.clientOnline && !!state.connectivity.serviceOnline);
    const mentions = (highlights ? highlights(state) : state?.unreadCounts?.totalUnreadHighlights) > 0;
    const unreads = state?.unreadCounts?.totalUnreads > 0;
    return `${!online || (!mentions && !unreads)}:${mentions}`;
  };
}

export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

export async function importImage(file: File | null): Promise<{ result: ImportResult; image?: string }> {
  if (!file) return { result: 'cancelled' };
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    return { result: 'unreadable' };
  }
  const [element, context] = canvas();
  contain(context, image);
  image.close();
  return { result: 'saved', image: element.toDataURL('image/png') };
}

export function useTabIcon(source: string | null | undefined, state: string | undefined): string | null {
  const [href, setHref] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!source) return setHref(null);
    const [dim, dot] = (state ?? 'false:false').split(':').map((flag) => flag === 'true');
    let live = true;
    badge(source, { dim, dot }).then(
      (next) => live && setHref(next),
      () => live && setHref(source),
    );
    return () => {
      live = false;
    };
  }, [source, state]);
  return href;
}
