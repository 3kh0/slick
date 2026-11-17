import type { Block } from '$slick';

const AUX: Record<string, string> = {
  is: 'are',
  was: 'were',
  has: 'have',
  does: 'do',
  "isn't": "aren't",
  "wasn't": "weren't",
  "hasn't": "haven't",
  "doesn't": "don't",
};

const FIXED: Record<string, string> = {
  him: 'them',
  hers: 'theirs',
  himself: 'themself',
  herself: 'themself',
  "he'd": "they'd",
  "she'd": "they'd",
  "he'll": "they'll",
  "she'll": "they'll",
};

const ADVERBS = new Set(
  'always also never often just still sometimes usually already even only ever perhaps maybe almost rarely seldom'.split(
    ' ',
  ),
);

const NOT_OWNED = new Set(
  `to and or but nor a an the about for that this these those in on at with from by of up out back off over
  down into onto through around too again so if when while as now then today tonight yesterday tomorrow later
  soon before after why what how where who whom some any my your our their his her its me you him them us it i
  we they he she everything something anything nothing all is was are were has have had will would can could
  should does did more less much though yet here there already anyway instead very well know go come see do be
  get take make leave stay try help talk say tell think decide finish start sleep eat rest win laugh cry feel`.split(
    /\s+/,
  ),
);

const INVERTS = new Set('what where when why how who which so neither nor'.split(' '));

const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)?/g;

function matchCase(original: string, next: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return next.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return next[0].toUpperCase() + next.slice(1);
  return next;
}

function pluralVerb(word: string): string | null {
  if (Object.hasOwn(AUX, word)) return AUX[word];
  if (!word.endsWith('s') || /(ss|us|is|'s)$/.test(word) || ADVERBS.has(word)) return null;
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|sh|ch|x|z|o)es$/.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}

export function neutralize(text: string): string {
  const words = [...text.matchAll(WORD)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    raw: m[0],
    lower: m[0].toLowerCase().replace('’', "'"),
  }));
  const out = new Map<number, string>();
  const set = (i: number, next: string) =>
    out.set(i, matchCase(words[i].raw, words[i].raw.includes('’') ? next.replace("'", '’') : next));
  const joined = (i: number, j: number) =>
    i >= 0 && j < words.length && /^[ \t]+$/.test(text.slice(words[i].end, words[j].start));
  const isPart = (i: number) =>
    /[/_@#-]/.test(text[words[i].start - 1] ?? '') || /[/_@#-]/.test(text[words[i].end] ?? '');

  for (let i = 0; i < words.length; i++) {
    if (isPart(i)) continue;
    const w = words[i].lower;
    const next = joined(i, i + 1) ? words[i + 1].lower : null;

    if (w === 'he' || w === 'she') {
      set(i, 'they');
      let v = i + 1;
      if (next && (ADVERBS.has(next) || next.endsWith('ly')) && joined(v, v + 1)) v++;
      const verb = joined(v - 1, v) && !isPart(v) && pluralVerb(words[v].lower);
      if (verb) set(v, verb);
      const a = i - 1;
      const before = a - 1;
      if (
        joined(a, i) &&
        Object.hasOwn(AUX, words[a].lower) &&
        (before < 0 ||
          !/^[ \t]+$/.test(text.slice(words[before].end, words[a].start)) ||
          INVERTS.has(words[before].lower))
      )
        set(a, AUX[words[a].lower]);
    } else if (w === "he's" || w === "she's" || w === 'hes' || w === 'shes') {
      const they = next === 'been' || next === 'got' || next === 'gotten' ? "they've" : "they're";
      set(i, w.includes("'") ? they : they.replace("'", ''));
    } else if (Object.hasOwn(FIXED, w)) {
      set(i, FIXED[w]);
    } else if (w === 'his') {
      set(i, !next || NOT_OWNED.has(next) ? 'theirs' : 'their');
    } else if (w === 'her') {
      set(i, !next || NOT_OWNED.has(next) ? 'them' : 'their');
    }
  }

  if (!out.size) return text;
  let result = '';
  let last = 0;
  for (const [i, next] of [...out].toSorted((a, b) => a[0] - b[0])) {
    result += text.slice(last, words[i].start) + next;
    last = words[i].end;
  }
  return result + text.slice(last);
}

export function neutralizeBlocks(blocks: Block[]): Block[] {
  const visit = (element: Block): Block => {
    if (element.type === 'rich_text_preformatted') return element;
    if (element.type === 'text') {
      if ((element.style as { code?: boolean } | undefined)?.code || typeof element.text !== 'string') return element;
      const text = neutralize(element.text);
      return text === element.text ? element : { ...element, text };
    }
    if (
      !['rich_text', 'rich_text_section', 'rich_text_list', 'rich_text_quote'].includes(String(element.type)) ||
      !Array.isArray(element.elements)
    )
      return element;
    const elements = element.elements.map(visit);
    return elements.some((child, i) => child !== (element.elements as Block[])[i]) ? { ...element, elements } : element;
  };
  const next = blocks.map((block) => (block.type === 'rich_text' ? visit(block) : block));
  return next.some((block, i) => block !== blocks[i]) ? next : blocks;
}
