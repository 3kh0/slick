// Quill puts code-block formatting on the newline ending a line, not its text.
// Transform copies of pasted ops so the clipboard and undo history keep their originals.
export type PasteOp = { insert?: string | object; attributes?: Record<string, unknown> };

export function relabelUrl(text: string, url: string, next: string): string {
  if (text === url) return next;
  const scheme = url.slice(0, url.length - text.length);
  return text && url.endsWith(text) && /^[a-z][a-z0-9+.-]*:(\/\/)?$/i.test(scheme) && next.startsWith(scheme)
    ? next.slice(scheme.length)
    : text;
}

function cleanPlainText(text: string, cleanUrl: (url: string) => string): string {
  return text.replace(/https?:\/\/[^\s<>"'`|]+/gi, (match) => {
    const trailing = /[.,;:!?)\]]+$/.exec(match)?.[0] ?? '';
    const url = trailing ? match.slice(0, -trailing.length) : match;
    return cleanUrl(url) + trailing;
  });
}

export function cleanPastedOps(ops: PasteOp[], cleanUrl: (url: string) => string): PasteOp[] | null {
  const text = ops.map((op) => (typeof op.insert === 'string' ? op.insert : '\uFFFC')).join('');
  const code = new Uint8Array(text.length);
  let position = text.length;
  let codeLine = false;
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    const insert = typeof op.insert === 'string' ? op.insert : '\uFFFC';
    for (let k = insert.length - 1; k >= 0; k--) {
      if (insert[k] === '\n') codeLine = !!op.attributes?.['code-block'];
      code[--position] = Number(codeLine || !!op.attributes?.code);
    }
  }
  // Markdown mode and intercepted Markdown pastes carry code as literal backticks.
  const ticks = [...text.matchAll(/`+/g)];
  for (let i = 0; i < ticks.length; i++) {
    const opening = ticks[i];
    const length = opening[0].length;
    const closing = ticks.findIndex(
      (run, index) => index > i && (length >= 3 ? run[0].length >= length : run[0].length === length),
    );
    if (closing !== -1) {
      code.fill(1, opening.index, ticks[closing].index + ticks[closing][0].length);
      i = closing;
    } else if (length >= 3) {
      code.fill(1, opening.index);
      break;
    }
  }

  let changed = false;
  let at = 0;
  const next = ops.map((op) => {
    const start = at;
    at += typeof op.insert === 'string' ? op.insert.length : 1;
    if (typeof op.insert !== 'string' || op.attributes?.unlink) return op;
    const link = op.attributes?.link;
    if (typeof link === 'string') {
      if (code.subarray(start, at).some(Boolean)) return op;
      const cleaned = cleanUrl(link);
      if (cleaned === link) return op;
      changed = true;
      return { ...op, insert: relabelUrl(op.insert, link, cleaned), attributes: { ...op.attributes, link: cleaned } };
    }
    let insert = '';
    let from = 0;
    while (from < op.insert.length) {
      const protectedText = code[start + from];
      let to = from + 1;
      while (to < op.insert.length && code[start + to] === protectedText) to++;
      const segment = op.insert.slice(from, to);
      insert += protectedText ? segment : cleanPlainText(segment, cleanUrl);
      from = to;
    }
    if (insert === op.insert) return op;
    changed = true;
    return { ...op, insert };
  });
  return changed ? next : null;
}

type PasteDelta = { ops: PasteOp[] };
type PasteArgs = { pastedDelta?: PasteDelta; formats?: Record<string, unknown> };
type MarkdownPaste = { markdownText: string };
type Clipboard = { options?: { onMarkdownPasteIntercepted?: (paste: MarkdownPaste) => void } };
export type ClipboardPrototype = {
  preparePastedDelta(this: Clipboard, args?: PasteArgs): unknown;
  maybeInterceptMarkdownPaste?: (
    this: Clipboard,
    event: unknown,
    plainPasteIntent?: boolean,
    formats?: Record<string, unknown>,
  ) => boolean;
};

/** Restore only our own wrappers, so another patch installed later is left intact. */
export function patchClipboard(proto: ClipboardPrototype, cleanUrl: (url: string) => string): () => void {
  let active = true;
  const prepare = proto.preparePastedDelta;
  const intercepted = proto.maybeInterceptMarkdownPaste;
  const isCode = (formats?: Record<string, unknown>) => !!(formats?.code || formats?.['code-block']);
  const prepareWrapped: ClipboardPrototype['preparePastedDelta'] = function (args) {
    let next = args;
    if (active && Array.isArray(args?.pastedDelta?.ops) && !isCode(args?.formats)) {
      try {
        const ops = cleanPastedOps(args.pastedDelta.ops, cleanUrl);
        if (ops) {
          const Delta = args.pastedDelta.constructor as new (ops: PasteOp[]) => PasteDelta;
          next = { ...args, pastedDelta: new Delta(ops) };
        }
      } catch (error) {
        console.error('[slick] could not clean pasted URLs:', error);
      }
    }
    return prepare.call(this, next);
  };
  const interceptWrapped: NonNullable<ClipboardPrototype['maybeInterceptMarkdownPaste']> = function (...args) {
    const options = this.options;
    const originalHandler = options?.onMarkdownPasteIntercepted;
    if (!active || !options || !originalHandler || isCode(args[2])) return intercepted!.apply(this, args);
    const handler = (paste: MarkdownPaste) => {
      let markdownText = paste.markdownText;
      if (active) {
        try {
          const ops = cleanPastedOps([{ insert: markdownText }], cleanUrl);
          if (typeof ops?.[0]?.insert === 'string') markdownText = ops[0].insert;
        } catch (error) {
          console.error('[slick] could not clean pasted Markdown URLs:', error);
        }
      }
      originalHandler({ ...paste, markdownText });
    };
    options.onMarkdownPasteIntercepted = handler;
    try {
      return intercepted!.apply(this, args);
    } finally {
      if (options.onMarkdownPasteIntercepted === handler) options.onMarkdownPasteIntercepted = originalHandler;
    }
  };
  proto.preparePastedDelta = prepareWrapped;
  if (intercepted) proto.maybeInterceptMarkdownPaste = interceptWrapped;
  return () => {
    active = false;
    if (proto.preparePastedDelta === prepareWrapped) proto.preparePastedDelta = prepare;
    if (proto.maybeInterceptMarkdownPaste === interceptWrapped) proto.maybeInterceptMarkdownPaste = intercepted;
  };
}
