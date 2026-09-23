// https://github.com/hackclub/orpheus-bot/tree/master/app/lib/haiku_check

export type SyllableLookup = (word: string) => number | undefined;

const SUB_SYLLABLES = [
  'cial',
  'tia',
  'cius',
  'cious',
  'uiet',
  'gious',
  'geous',
  'priest',
  'giu',
  'dge',
  'ion',
  'iou',
  'sia$',
  '.che$',
  '.ched$',
  '.abe$',
  '.ace$',
  '.ade$',
  '.age$',
  '.aged$',
  '.ake$',
  '.ale$',
  '.aled$',
  '.ales$',
  '.ane$',
  '.ame$',
  '.ape$',
  '.are$',
  '.ase$',
  '.ashed$',
  '.asque$',
  '.ate$',
  '.ave$',
  '.azed$',
  '.awe$',
  '.aze$',
  '.aped$',
  '.athe$',
  '.athes$',
  '.ece$',
  '.ese$',
  '.esque$',
  '.esques$',
  '.eze$',
  '.gue$',
  '.ibe$',
  '.ice$',
  '.ide$',
  '.ife$',
  '.ike$',
  '.ile$',
  '.ime$',
  '.ine$',
  '.ipe$',
  '.iped$',
  '.ire$',
  '.ise$',
  '.ished$',
  '.ite$',
  '.ive$',
  '.ize$',
  '.obe$',
  '.ode$',
  '.oke$',
  '.ole$',
  '.ome$',
  '.one$',
  '.ope$',
  '.oque$',
  '.ore$',
  '.ose$',
  '.osque$',
  '.osques$',
  '.ote$',
  '.ove$',
  '.pped$',
  '.sse$',
  '.ssed$',
  '.ste$',
  '.ube$',
  '.uce$',
  '.ude$',
  '.uge$',
  '.uke$',
  '.ule$',
  '.ules$',
  '.uled$',
  '.ume$',
  '.une$',
  '.upe$',
  '.ure$',
  '.use$',
  '.ushed$',
  '.ute$',
  '.ved$',
  '.we$',
  '.wes$',
  '.wed$',
  '.yse$',
  '.yze$',
  '.rse$',
  '.red$',
  '.rce$',
  '.rde$',
  '.ily$',
  '.ely$',
  '.des$',
  '.gged$',
  '.kes$',
  '.ced$',
  '.ked$',
  '.med$',
  '.mes$',
  '.ned$',
  '.[sz]ed$',
  '.nce$',
  '.rles$',
  '.nes$',
  '.pes$',
  '.tes$',
  '.res$',
  '.ves$',
  'ere$',
].map((pattern) => new RegExp(pattern));

const ADD_SYLLABLES = [
  'ia',
  'riet',
  'dien',
  'ien',
  'iet',
  'iu',
  'iest',
  'io',
  'ii',
  'ily',
  '.oala$',
  '.iara$',
  '.ying$',
  '.earest',
  '.arer',
  '.aress',
  '.eate$',
  '.eation$',
  '[aeiouym]bl$',
  '[aeiou]{3}',
  '^mc',
  'ism',
  '^mc',
  'asm',
  // A lost backslash in Orpheus: a literal "1", which never matches. Kept for parity.
  '([^aeiouy])1l$',
  '[^l]lien',
  '^coa[dglx].',
  '[^gq]ua[^auieo]',
  'dnt$',
].map((pattern) => new RegExp(pattern));

const SMALL = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;

const LOTS = [
  '',
  'thousand',
  'million',
  'billion',
  'trillion',
  'quadrillion',
  'quintillion',
  'sextillion',
  'septillion',
  'octillion',
  'nonillion',
  'decillion',
  'undecillion',
  'duodecillion',
  'tredecillion',
  'quattuordecillion',
  'quindecillion',
  'sexdecillion',
  'septendecillion',
  'octodecillion',
  'novemdecillion',
  'vigintillion',
  'unvigintillion',
  'duovigintillion',
  'trevigintillion',
  'quattuortillion',
  'quinvigintillion',
  'sexvigintillion',
  'septenvigintillion',
  'octovigintillion',
  'novemvigintillion',
  'trigintillion',
  'untrigintillion',
  'duotrigintillion',
  'trestrigintillion',
  'quattuortrigintillion',
  'quintrigintillion',
  'sextrigintillion',
  'septentrigintillion',
  'octotrigintillion',
  'novemtrigintillion',
  'quadragintillion',
  'unquadragintillion',
  'duoquadragintillion',
  'trequadragintillion',
  'quattuorquadragintillion',
  'quinquadragintillion',
  'sesquadragintillion',
  'septenquadragintillion',
  'octoquadragintillion',
  'novenquadragintillion',
  'quinquagintillion',
] as const;

function underThousand(value: number): string {
  if (value < 20) return SMALL[value];
  if (value < 100) {
    const remainder = value % 10;
    return `${TENS[Math.floor(value / 10)]}${remainder ? `-${SMALL[remainder]}` : ''}`;
  }
  const remainder = value % 100;
  return `${SMALL[Math.floor(value / 100)]} hundred${remainder ? ` and ${underThousand(remainder)}` : ''}`;
}

/** Matches Integer#humanize from humanize 3.1.0, which Orpheus uses. */
export function humanizeInteger(digits: string): string {
  let value = BigInt(digits);
  if (value === 0n) return 'zero';

  let iteration = 0;
  let useAnd = false;
  const parts: string[] = [];
  while (value !== 0n) {
    const remainder = Number(value % 1000n);
    value /= 1000n;
    if (remainder !== 0) {
      if (iteration === 0 && remainder < 100) useAnd = true;
      else if (LOTS[iteration]) {
        parts.push(`${LOTS[iteration]}${parts.length ? (useAnd ? ' and' : ',') : ''}`);
      }
      parts.push(underThousand(remainder));
    }
    iteration++;
  }
  return parts.toReversed().join(' ');
}

export function estimateSyllables(word: string): number {
  if (!word) return 0;
  word = word.toLowerCase();
  let syllables = word.split(/[^aeiouy]+/).filter(Boolean).length;
  for (const pattern of SUB_SYLLABLES) {
    if (pattern.test(word)) syllables--;
  }
  for (const pattern of ADD_SYLLABLES) {
    if (pattern.test(word)) syllables++;
  }
  return Math.max(1, syllables);
}

/**
 * Tests the same normalized text and 5/7/5 word boundaries as Orpheus.
 * The caller supplies Orpheus's pronunciation-table lookup.
 */
export function findHaiku(input: string, lookup: SyllableLookup): [string, string, string] | null {
  // Ruby's `\s` is ASCII-only; JavaScript's also includes Unicode spaces.
  let text = input.toLowerCase().replace(/[^a-zA-Z0-9 \t\n\v\f\r.$]/g, '');
  text = text.replace(/\$/g, 'dollar ').replace(/\bise\b/g, 'ize');
  text = text.replace(/\d+/g, humanizeInteger);

  const lines: string[][] = [[], [], []];
  const targets = [5, 7, 5];
  let line = 0;
  let count = 0;
  for (const word of text.split(/[ \t\n\v\f\r]+/).filter(Boolean)) {
    const syllables = lookup(word) ?? estimateSyllables(word);
    if (line > 2 || count + syllables > targets[line]) return null;
    lines[line].push(word);
    count += syllables;
    if (count === targets[line]) {
      line++;
      count = 0;
    }
  }

  return line === 3 ? [lines[0].join(' '), lines[1].join(' '), lines[2].join(' ')] : null;
}

/** Looks up one word without allocating a 134k-entry Map. Input must be sorted. */
export function dictionaryLookup(dictionary: string, word: string): number | undefined {
  let low = 0;
  let high = dictionary.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const lineStart = middle === 0 ? 0 : dictionary.lastIndexOf('\n', middle - 1) + 1;
    let lineEnd = dictionary.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = dictionary.length;
    const separator = dictionary.lastIndexOf(' ', lineEnd - 1);
    const candidate = dictionary.slice(lineStart, separator);
    if (candidate === word) return Number(dictionary.slice(separator + 1, lineEnd));
    if (candidate < word) low = lineEnd + 1;
    else high = lineStart;
  }
  return undefined;
}

type RichTextNode = {
  type?: string;
  text?: string;
  url?: string;
  user_id?: string;
  channel_id?: string;
  usergroup_id?: string;
  name?: string;
  range?: string;
  timestamp?: number;
  format?: string;
  fallback?: string;
  elements?: RichTextNode[];
};

function nodeText(node: RichTextNode): string {
  switch (node.type) {
    case 'text':
      return node.text ?? '';
    case 'link':
      return node.text ? `<${node.url}|${node.text}>` : `<${node.url}>`;
    case 'user':
      return `<@${node.user_id}>`;
    case 'channel':
      return `<#${node.channel_id}>`;
    case 'usergroup':
      return `<!subteam^${node.usergroup_id}>`;
    case 'broadcast':
      return `<!${node.range}>`;
    case 'emoji':
      return `:${node.name}:`;
    case 'date':
      return `<!date^${node.timestamp}^${node.format}|${node.fallback}>`;
  }

  const separator = node.type === 'rich_text_list' || node.type === 'rich_text_quote' ? '\n' : '';
  return (node.elements ?? []).map(nodeText).join(separator);
}

/** Recreates the mrkdwn-like text delivered with Slack message events. */
export function blocksToSlackText(blocks: unknown[]): string {
  return (blocks as RichTextNode[]).map(nodeText).join('\n');
}
