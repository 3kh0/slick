(function () {
  'use strict';

  if (window.__slickNotShitMarkdown) return;

  const state = (window.__slickNotShitMarkdown = {
    transformed: 0,
    last: null,
  });

  const API_RE = /\/api\/chat\.(postMessage|update|scheduleMessage)/;
  const HAS_MARKDOWN_RE =
    /(\*\*|__|~~|`|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^) \n]+\)|(^|[\s([>])\*[^*\n]+\*|(^|[\s([>])_[^_\n]+_)/m;

  function cloneStyle(style) {
    return style && typeof style === 'object' && !Array.isArray(style) ? Object.assign({}, style) : {};
  }

  function sameStyle(a, b) {
    const ak = Object.keys(a || {});
    const bk = Object.keys(b || {});
    return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
  }

  function pushText(out, text, style) {
    if (!text) return;
    const normalized = text.replace(/\\([\\`*_~[\]()])/g, '$1');
    if (!normalized) return;
    const last = out[out.length - 1];
    if (last && last.type === 'text' && sameStyle(last.style || {}, style || {})) {
      last.text += normalized;
      return;
    }
    const node = { type: 'text', text: normalized };
    if (style && Object.keys(style).length) node.style = cloneStyle(style);
    out.push(node);
  }

  function findClose(text, marker, start) {
    let at = start;
    while ((at = text.indexOf(marker, at)) !== -1) {
      if (text[at - 1] !== '\\') return at;
      at += marker.length;
    }
    return -1;
  }

  function isWord(char) {
    return /[A-Za-z0-9]/.test(char || '');
  }

  function canOpenEmphasis(text, at, marker) {
    const prev = text[at - 1] || '';
    const next = text[at + 1] || '';
    if (!next || /\s/.test(next)) return false;
    if (marker === '_' && isWord(prev)) return false;
    return true;
  }

  function canCloseEmphasis(text, at, marker) {
    const prev = text[at - 1] || '';
    const next = text[at + 1] || '';
    if (!prev || /\s/.test(prev)) return false;
    if (marker === '_' && isWord(next)) return false;
    return true;
  }

  function parseInline(text, baseStyle) {
    const out = [];
    let i = 0;
    const style = cloneStyle(baseStyle);

    while (i < text.length) {
      const ch = text[i];
      const two = text.slice(i, i + 2);

      if (ch === '\\' && i + 1 < text.length) {
        pushText(out, text.slice(i, i + 2), style);
        i += 2;
        continue;
      }

      if (ch === '`') {
        const end = findClose(text, '`', i + 1);
        if (end !== -1) {
          pushText(out, text.slice(i + 1, end), Object.assign({}, style, { code: true }));
          i = end + 1;
          continue;
        }
      }

      if (two === '**' || two === '__' || two === '~~') {
        const end = findClose(text, two, i + 2);
        if (end !== -1) {
          const key = two === '~~' ? 'strike' : 'bold';
          const inner = parseInline(text.slice(i + 2, end), Object.assign({}, style, { [key]: true }));
          out.push(...inner);
          i = end + 2;
          continue;
        }
      }

      if ((ch === '*' || ch === '_') && text[i - 1] !== ch && text[i + 1] !== ch && canOpenEmphasis(text, i, ch)) {
        const end = findClose(text, ch, i + 1);
        if (
          end !== -1 &&
          text[end + 1] !== ch &&
          canCloseEmphasis(text, end, ch) &&
          /\S/.test(text.slice(i + 1, end))
        ) {
          const inner = parseInline(text.slice(i + 1, end), Object.assign({}, style, { italic: true }));
          out.push(...inner);
          i = end + 1;
          continue;
        }
      }

      if (ch === '[') {
        const labelEnd = findClose(text, ']', i + 1);
        if (labelEnd !== -1 && text[labelEnd + 1] === '(') {
          const urlEnd = findClose(text, ')', labelEnd + 2);
          const url = urlEnd === -1 ? '' : text.slice(labelEnd + 2, urlEnd);
          if (/^(https?:\/\/|mailto:)[^\s)]+$/i.test(url)) {
            const label = text.slice(i + 1, labelEnd).replace(/\\([\\`*_~[\]()])/g, '$1');
            const node = { type: 'link', url, text: label || url };
            if (Object.keys(style).length) node.style = cloneStyle(style);
            out.push(node);
            i = urlEnd + 1;
            continue;
          }
        }
      }

      let next = text.length;
      for (const marker of ['\\', '`', '**', '__', '~~', '*', '_', '[']) {
        const at = text.indexOf(marker, i + 1);
        if (at !== -1 && at < next) next = at;
      }
      pushText(out, text.slice(i, next), style);
      i = next;
    }

    return out;
  }

  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
  }

  function inlineToHTML(nodes) {
    let styled = false;
    const html = nodes
      .map((node) => {
        if (!node || typeof node !== 'object') return '';
        if (node.type === 'link') {
          styled = true;
          const text = escapeHTML(node.text || node.url);
          return `<a href="${escapeHTML(node.url)}">${text}</a>`;
        }
        let text = escapeHTML(node.text || '');
        const style = node.style || {};
        if (style.code) {
          styled = true;
          text = `<code>${text}</code>`;
        }
        if (style.bold) {
          styled = true;
          text = `<strong>${text}</strong>`;
        }
        if (style.italic) {
          styled = true;
          text = `<em>${text}</em>`;
        }
        if (style.strike) {
          styled = true;
          text = `<s>${text}</s>`;
        }
        return text;
      })
      .join('');
    return styled ? html : null;
  }

  function editorFrom(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    return node.matches('.ql-editor') ? node : node.closest?.('.ql-editor');
  }

  function inFormattedNode(node) {
    return !!node?.parentElement?.closest('a,b,strong,i,em,s,strike,code,pre');
  }

  function transformTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || inFormattedNode(node)) return false;
    const text = node.nodeValue || '';
    if (!HAS_MARKDOWN_RE.test(text)) return false;
    const html = inlineToHTML(parseInline(text));
    if (!html) return false;

    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('insertHTML', false, html);
    return true;
  }

  function transformComposer(editor) {
    if (!editor || editor.__slickMarkdownTransforming) return;
    editor.__slickMarkdownTransforming = true;
    try {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (inFormattedNode(node)) return NodeFilter.FILTER_REJECT;
          return HAS_MARKDOWN_RE.test(node.nodeValue || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      });
      const node = walker.nextNode();
      if (!transformTextNode(node)) return;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    } finally {
      editor.__slickMarkdownTransforming = false;
    }
  }

  function selectionTextBefore(range, editor) {
    const before = range.cloneRange();
    before.selectNodeContents(editor);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString();
  }

  function unescapedIndexOf(text, marker, from) {
    let at = text.lastIndexOf(marker, from);
    while (at !== -1) {
      if (text[at - 1] !== '\\') return at;
      at = text.lastIndexOf(marker, at - 1);
    }
    return -1;
  }

  function canUseDelimiter(text, open, marker) {
    if (marker === '`') return true;
    if (marker === '~~') return true;
    if (marker.length === 2) return canOpenEmphasis(text, open, marker[0]);
    if (text[open - 1] === marker || text[open + 1] === marker) return false;
    return canOpenEmphasis(text, open, marker) && canCloseEmphasis(text, text.length - 1, marker);
  }

  function closingDelimited(text, typed) {
    if (!text) return null;
    const markers =
      typed === '*' ? ['**', '*'] : typed === '_' ? ['__', '_'] : typed === '~' ? ['~~'] : typed === '`' ? ['`'] : [];
    for (const marker of markers) {
      const beforeClose = marker.slice(0, -1);
      if (beforeClose && !text.endsWith(beforeClose)) continue;
      const before = beforeClose ? text.slice(0, -beforeClose.length) : text;
      const open = unescapedIndexOf(before, marker, before.length - 1);
      if (open === -1) continue;
      if (marker.length === 1 && (before[open - 1] === marker || before[open + 1] === marker)) continue;
      const inner = before.slice(open + marker.length);
      if (!inner || /[\n\r]/.test(inner) || !/\S/.test(inner)) continue;
      const source = text.slice(open) + typed;
      if (!canUseDelimiter(source, 0, marker)) continue;
      return { marker, open, source };
    }
    return null;
  }

  function pendingDoubleClose(text, typed) {
    if (!['*', '_', '~'].includes(typed) || text.endsWith(typed)) return false;
    const marker = typed + typed;
    const open = unescapedIndexOf(text, marker, text.length - 1);
    if (open === -1) return false;
    const inner = text.slice(open + marker.length);
    if (!inner || /[\n\r]/.test(inner) || !/\S/.test(inner)) return null;
    return { marker, open, source: text.slice(open) + marker, swallow: typed };
  }

  function closingLink(text) {
    const match = /(^|[\s([>])\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^) \n]+)$/.exec(text);
    if (!match) return null;
    const open = match.index + match[1].length;
    return { open, source: `${text.slice(open)})` };
  }

  function textPointAt(editor, offset) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();
    while (node) {
      const len = node.nodeValue.length;
      if (remaining <= len) return { node, offset: remaining };
      remaining -= len;
      node = walker.nextNode();
    }
    return null;
  }

  function markerTag(marker) {
    if (marker === '**' || marker === '__') return 'strong';
    if (marker === '~~') return 's';
    return null;
  }

  function fragmentHTML(fragment) {
    const div = document.createElement('div');
    div.appendChild(fragment);
    return div.innerHTML;
  }

  const QUILL_FORMATS = ['bold', 'italic', 'strike', 'code', 'link'];

  function quillFor(editor) {
    const container = editor && editor.parentElement;
    const quill = container && container.__quill;
    return quill && typeof quill.formatText === 'function' && typeof quill.getSelection === 'function' ? quill : null;
  }

  function formatKeyForMarker(marker) {
    if (marker === '**' || marker === '__') return 'bold';
    if (marker === '*' || marker === '_') return 'italic';
    if (marker === '~~') return 'strike';
    if (marker === '`') return 'code';
    return null;
  }

  function clearPending(quill) {
    for (const key of QUILL_FORMATS) quill.format(key, false, 'user');
  }

  function formatObject(node) {
    const fmt = {};
    if (node.type === 'link') fmt.link = node.url;
    const style = node.style;
    if (style) {
      if (style.bold) fmt.bold = true;
      if (style.italic) fmt.italic = true;
      if (style.strike) fmt.strike = true;
      if (style.code) fmt.code = true;
    }
    return fmt;
  }

  function applyEmphasisViaQuill(quill, match, caretIndex) {
    const key = formatKeyForMarker(match.marker);
    if (!key) return false;
    const markerLen = match.marker.length;
    const openIndex = caretIndex - match.regionLen;
    const innerLen = match.regionLen - markerLen;
    if (openIndex < 0 || innerLen <= 0) return false;
    if (quill.getText(openIndex, markerLen) !== match.marker) return false;

    quill.formatText(openIndex + markerLen, innerLen, key, true, 'user');
    quill.deleteText(openIndex, markerLen, 'user');
    quill.setSelection(openIndex + innerLen, 0, 'user');
    clearPending(quill);
    return true;
  }

  function applyParsedViaQuill(quill, match, caretIndex) {
    const openIndex = caretIndex - match.regionLen;
    if (openIndex < 0) return false;
    const nodes = parseInline(match.source);
    if (!nodes.length) return false;

    quill.deleteText(openIndex, match.regionLen, 'user');
    let index = openIndex;
    for (const node of nodes) {
      const text = node.type === 'link' ? node.text || node.url : node.text || '';
      if (!text) continue;
      quill.insertText(index, text, formatObject(node), 'user');
      index += text.length;
    }
    quill.setSelection(index, 0, 'user');
    clearPending(quill);
    return true;
  }

  function applyViaQuill(quill, match) {
    const selection = quill.getSelection();
    if (!selection || typeof selection.index !== 'number') return false;
    return match.marker
      ? applyEmphasisViaQuill(quill, match, selection.index)
      : applyParsedViaQuill(quill, match, selection.index);
  }

  function wrapTypedMarkdown(editor, range, match) {
    const tag = markerTag(match.marker);
    if (!tag) return false;
    const inner = match.source.slice(match.marker.length, -match.marker.length);
    if (HAS_MARKDOWN_RE.test(inner)) return false;

    const start = textPointAt(editor, match.open);
    const innerStart = textPointAt(editor, match.open + match.marker.length);
    if (!start || !innerStart) return false;

    const content = document.createRange();
    content.setStart(innerStart.node, innerStart.offset);
    content.setEnd(range.startContainer, range.startOffset);

    const replace = document.createRange();
    replace.setStart(start.node, start.offset);
    replace.setEnd(range.startContainer, range.startOffset);

    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(replace);
    document.execCommand('insertHTML', false, `<${tag}>${fragmentHTML(content.cloneContents())}</${tag}>`);
    return true;
  }

  function replaceTypedMarkdown(event, match) {
    const editor = editorFrom(event.target) || editorFrom(document.activeElement);
    if (!editor || editor.__slickMarkdownTransforming) return;
    const selection = getSelection();
    if (!selection || selection.rangeCount !== 1 || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;

    const quill = quillFor(editor);
    const start = quill ? null : textPointAt(editor, match.open);
    if (!quill && !start) return;

    event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    editor.__slickMarkdownTransforming = true;
    try {
      if (!(quill && applyViaQuill(quill, match))) {
        const point = start || textPointAt(editor, match.open);
        if (!point) return;
        if (!wrapTypedMarkdown(editor, range, match)) {
          const replace = document.createRange();
          replace.setStart(point.node, point.offset);
          replace.setEnd(range.startContainer, range.startOffset);
          selection.removeAllRanges();
          selection.addRange(replace);
          document.execCommand('insertHTML', false, inlineToHTML(parseInline(match.source)));
        }
      }
      if (match.swallow) editor.__slickMarkdownSwallow = match.swallow;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    } finally {
      editor.__slickMarkdownTransforming = false;
    }
  }

  function interceptTypedMarkdown(event, typed) {
    if (event.defaultPrevented) return;
    const editor = editorFrom(event.target) || editorFrom(document.activeElement);
    if (!editor || editor.__slickMarkdownTransforming) return;
    if (editor.__slickMarkdownSwallow === typed) {
      editor.__slickMarkdownSwallow = null;
      event.preventDefault();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      return;
    }
    const selection = getSelection();
    if (!selection || selection.rangeCount !== 1 || !selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;

    const before = selectionTextBefore(range, editor);
    const match =
      typed === ')' ? closingLink(before) : closingDelimited(before, typed) || pendingDoubleClose(before, typed);
    if (match) {
      match.regionLen = before.length - match.open;
      replaceTypedMarkdown(event, match);
    }
  }

  function interceptBeforeInput(event) {
    if (event.inputType !== 'insertText' || !['*', '_', '~', '`', ')'].includes(event.data)) return;
    interceptTypedMarkdown(event, event.data);
  }

  function interceptKeydown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['*', '_', '~', '`', ')'].includes(event.key)) return;
    interceptTypedMarkdown(event, event.key);
  }

  const composerTimers = new WeakMap();
  function scheduleComposerTransform(target) {
    const editor = editorFrom(target);
    if (!editor) return;
    clearTimeout(composerTimers.get(editor));
    composerTimers.set(
      editor,
      setTimeout(() => {
        composerTimers.delete(editor);
        transformComposer(editor);
      }, 120),
    );
  }

  function markdownToMrkdwn(text) {
    if (typeof text !== 'string' || !HAS_MARKDOWN_RE.test(text)) return text;
    return text
      .replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^) \n]+)\)/g, '<$2|$1>')
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?=$|[^\w*])/g, '$1_$2_')
      .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
      .replace(/__([^_\n]+)__/g, '*$1*')
      .replace(/~~([^~\n]+)~~/g, '~$1~');
  }

  function transformElements(elements, inCode) {
    if (!Array.isArray(elements)) return false;
    let changed = false;
    for (let i = 0; i < elements.length; i++) {
      const node = elements[i];
      if (!node || typeof node !== 'object') continue;
      const nodeIsCode = inCode || node.type === 'rich_text_preformatted' || node.style?.code === true;
      if (!nodeIsCode && node.type === 'text' && typeof node.text === 'string' && HAS_MARKDOWN_RE.test(node.text)) {
        const next = parseInline(node.text, node.style);
        if (next.length) {
          elements.splice(i, 1, ...next);
          i += next.length - 1;
          changed = true;
        }
        continue;
      }
      if (transformElements(node.elements, nodeIsCode)) changed = true;
    }
    return changed;
  }

  function transformBlocks(blocks) {
    return transformElements(blocks);
  }

  function overJSON(json, fn) {
    try {
      const value = JSON.parse(json);
      return fn(value) ? JSON.stringify(value) : json;
    } catch (e) {
      return json;
    }
  }

  function transformBodyValue(key, value) {
    if (typeof value !== 'string') return value;
    if (key === 'blocks') {
      return overJSON(value, transformBlocks);
    }
    if (key === 'text') return markdownToMrkdwn(value);
    return value;
  }

  function transformBody(body) {
    let changed = false;

    if (body instanceof FormData || body instanceof URLSearchParams) {
      for (const key of ['blocks', 'text']) {
        const before = body.get(key);
        const after = transformBodyValue(key, before);
        if (after !== before) {
          body.set(key, after);
          changed = true;
        }
      }
      return { body, changed };
    }

    if (typeof body === 'string' && body[0] === '{') {
      try {
        const obj = JSON.parse(body);
        for (const key of ['blocks', 'text']) {
          if (typeof obj[key] !== 'string') continue;
          const after = transformBodyValue(key, obj[key]);
          if (after !== obj[key]) {
            obj[key] = after;
            changed = true;
          }
        }
        if (Array.isArray(obj.blocks) && transformBlocks(obj.blocks)) changed = true;
        return { body: changed ? JSON.stringify(obj) : body, changed };
      } catch (e) {}
    }

    return { body, changed: false };
  }

  function transformRequestBody(body) {
    const next = transformBody(body);
    if (next.changed) {
      state.transformed++;
      state.last = Date.now();
    }
    return next.body;
  }

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (API_RE.test(url) && init && init.body) init.body = transformRequestBody(init.body);
    } catch (e) {}
    return originalFetch.apply(this, arguments);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (_method, url) {
    this.__slickNotShitMarkdown = API_RE.test(String(url));
    return originalOpen.apply(this, arguments);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__slickNotShitMarkdown && body) arguments[0] = transformRequestBody(body);
    } catch (e) {}
    return originalSend.apply(this, arguments);
  };

  document.addEventListener('keydown', interceptKeydown, true);
  document.addEventListener('beforeinput', interceptBeforeInput, true);
  document.addEventListener('input', (event) => scheduleComposerTransform(event.target), true);

  state.parseInline = parseInline;
  state.markdownToMrkdwn = markdownToMrkdwn;
  state.transformBlocks = transformBlocks;
  state.transformComposer = transformComposer;
  state.interceptTypedMarkdown = interceptTypedMarkdown;
  state.interceptKeydown = interceptKeydown;
  console.log('[NotShitMarkdown] active');
})();
