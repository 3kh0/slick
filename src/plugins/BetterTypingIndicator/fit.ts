export type Phrases = {
  one: string[];
  two: string[];
  others: (count: number) => string;
};

export type Box = {
  width: number;
  sample: number;
  fontFamily: string;
  fontSize: string;
  letterSpacing: string;
  regularWeight: string;
  boldWeight: string;
  avatar: number;
};

export type Measure = (text: string, font: string) => number;
export type Truncate = (text: string, width: number, font: string) => string;

const NAME_MIN_EMS = 8;
const WORD_MAX_EMS = 12;

export function fit(names: string[], phrases: Phrases, box: Box, measure: Measure, truncate: Truncate): string[] {
  const regular = `${box.regularWeight} ${box.fontSize} ${box.fontFamily}`;
  const bold = `${box.boldWeight} ${box.fontSize} ${box.fontFamily}`;
  const em = Number.parseFloat(box.fontSize);
  const widths = names.map((name) => measure(name, bold) + 1);
  const floors = names.map((name, i) =>
    !/\s/.test(name) && widths[i] <= WORD_MAX_EMS * em ? widths[i] : Math.min(widths[i], NAME_MIN_EMS * em),
  );

  const room = (named: number) => {
    const rest = names.length - named;
    const around = named > 1 || rest ? phrases.two : phrases.one;
    const others = rest ? measure(phrases.others(rest), bold) + 1 : 0;
    const commas = rest ? named - 1 : Math.max(named - 2, 0);
    return (
      box.width -
      around.reduce((sum, piece) => sum + measure(piece, regular), 0) -
      others -
      commas * measure(', ', regular) -
      named * box.avatar
    );
  };
  const fits = (named: number) => floors.slice(0, named).reduce((sum, floor) => sum + floor, 0) <= room(named);

  let named = 1;
  if (fits(names.length)) named = names.length;
  else while (named + 1 < names.length && fits(named + 1)) named++;

  const shown = widths.slice(0, named);
  const uncut = (i: number) => floors[i] === shown[i];
  const level = waterLevel(
    shown.filter((_, i) => !uncut(i)),
    shown.reduce((left, width, i) => (uncut(i) ? left - width : left), room(named)),
  );
  return names
    .slice(0, named)
    .map((name, i) => (uncut(i) || level === undefined ? name : truncate(name, Math.max(level, floors[i]) - 1, bold)));
}

export function waterLevel(widths: number[], room: number): number | undefined {
  if (widths.reduce((sum, width) => sum + width, 0) <= room) return undefined;
  const sorted = widths.toSorted((a, b) => a - b);
  let left = room;
  for (const [i, width] of sorted.entries()) {
    const share = left / (sorted.length - i);
    if (width > share) return share;
    left -= width;
  }
  return undefined;
}
