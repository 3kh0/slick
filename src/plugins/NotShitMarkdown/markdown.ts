import type { DeltaOp } from '$slick';

export type MarkdownConfig = {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  links: boolean;
};

type Attributes = NonNullable<DeltaOp['attributes']>;

const ESCAPABLE = new Set(['\\', '`', '*', '_', '~', '[', ']', '(', ')']);
const isWord = (char: string) => /[A-Za-z0-9]/.test(char);

export function canOpenEmphasis(text: string, at: number, marker: string): boolean {
  const previous = text[at - 1] ?? '';
  const next = text[at + marker.length] ?? '';
  if (!next || /\s/.test(next)) return false;
  if (marker[0] === '_' && marker.length === 1 && isWord(previous)) return false;
  return true;
}

export function canCloseEmphasis(text: string, at: number, marker: string): boolean {
  const previous = text[at - 1] ?? '';
  const next = text[at + marker.length] ?? '';
  if (!previous || /\s/.test(previous)) return false;
  if (marker[0] === '_' && marker.length === 1 && isWord(next)) return false;
  return true;
}

function escaped(text: string, at: number): boolean {
  let slashes = 0;
  for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function closingMarker(text: string, marker: string, from: number): number {
  for (let at = text.indexOf(marker, from); at !== -1; at = text.indexOf(marker, at + 1)) {
    if (escaped(text, at) || !canCloseEmphasis(text, at, marker)) continue;
    // In a run of three stars the final two close bold, leaving the first to
    // close a nested italic span.
    if (marker.length === 2 && text[at + marker.length] === marker[0]) continue;
    return at;
  }
  return -1;
}

function linkEnd(text: string, start: number): number {
  let depth = 0;
  for (let at = start; at < text.length; at++) {
    if (escaped(text, at)) continue;
    if (text[at] === '(') depth++;
    if (text[at] === ')' && depth-- === 0) return at;
  }
  return -1;
}

const inserted = (op: DeltaOp): string | object | undefined => ('insert' in op ? op.insert : undefined);

function push(out: DeltaOp[], insert: string, attributes: Attributes): void {
  if (!insert) return;
  const previous = out.at(-1);
  const previousText = previous && inserted(previous);
  if (
    previous &&
    typeof previousText === 'string' &&
    JSON.stringify(previous.attributes ?? {}) === JSON.stringify(attributes)
  ) {
    (previous as { insert: string }).insert = previousText + insert;
    return;
  }
  out.push(Object.keys(attributes).length ? { insert, attributes } : { insert });
}

export function parseMarkdown(text: string, active: Attributes, config: MarkdownConfig): DeltaOp[] {
  const out: DeltaOp[] = [];
  let plain = '';
  const flush = () => {
    push(out, plain, active);
    plain = '';
  };

  for (let at = 0; at < text.length;) {
    if (text[at] === '\\' && ESCAPABLE.has(text[at + 1] ?? '')) {
      plain += text[at + 1];
      at += 2;
      continue;
    }

    if (config.code && text[at] === '`' && !escaped(text, at)) {
      const end = text.indexOf('`', at + 1);
      if (end !== -1 && !escaped(text, end)) {
        flush();
        push(out, text.slice(at + 1, end), { ...active, code: true });
        at = end + 1;
        continue;
      }
    }

    const markers: Array<[string, keyof MarkdownConfig, keyof Attributes]> = [
      ['**', 'bold', 'bold'],
      ['__', 'bold', 'bold'],
      ['~~', 'strike', 'strike'],
      ['*', 'italic', 'italic'],
      ['_', 'italic', 'italic'],
    ];
    let formatted = false;
    for (const [marker, setting, attribute] of markers) {
      if (!config[setting] || !text.startsWith(marker, at) || escaped(text, at)) continue;
      if (marker.length === 1 && (text[at - 1] === marker || text[at + 1] === marker)) continue;
      if (!canOpenEmphasis(text, at, marker)) continue;
      const end = closingMarker(text, marker, at + marker.length);
      if (end === -1 || !/\S/.test(text.slice(at + marker.length, end))) continue;
      flush();
      out.push(...parseMarkdown(text.slice(at + marker.length, end), { ...active, [attribute]: true }, config));
      at = end + marker.length;
      formatted = true;
      break;
    }
    if (formatted) continue;

    if (config.links && text[at] === '[' && !escaped(text, at)) {
      const labelEnd = text.indexOf('](', at + 1);
      if (labelEnd !== -1) {
        const end = linkEnd(text, labelEnd + 2);
        const url = end === -1 ? '' : text.slice(labelEnd + 2, end);
        if (/^(https?:\/\/|mailto:)[^\s]+$/i.test(url)) {
          flush();
          const label = text.slice(at + 1, labelEnd).replace(/\\([\\`*_~[\]()])/g, '$1');
          push(out, label || url, { ...active, link: url });
          at = end + 1;
          continue;
        }
      }
    }

    plain += text[at];
    at++;
  }
  flush();
  return out;
}

export function transformOps(ops: DeltaOp[], config: MarkdownConfig): DeltaOp[] {
  let changed = false;
  const out: DeltaOp[] = [];
  for (const op of ops) {
    const insert = inserted(op);
    if (typeof insert !== 'string' || op.attributes?.code === true || op.attributes?.['code-block'] === true) {
      out.push(op);
      continue;
    }
    const parsed = parseMarkdown(insert, op.attributes ?? {}, config);
    if (parsed.length === 1 && inserted(parsed[0]) === insert && parsed[0].attributes === undefined && !op.attributes) {
      out.push(op);
      continue;
    }
    if (
      parsed.length === 1 &&
      inserted(parsed[0]) === insert &&
      JSON.stringify(parsed[0].attributes ?? {}) === JSON.stringify(op.attributes ?? {})
    ) {
      out.push(op);
      continue;
    }
    changed = true;
    out.push(...parsed);
  }
  return changed ? out : ops;
}
