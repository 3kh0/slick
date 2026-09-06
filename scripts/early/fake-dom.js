'use strict';

// A deliberately small DOM for Node tests of the shared text, element and style
// hubs. It implements only what runtime/early.js touches: simple selectors with
// no combinators, synchronous tree edits, and microtask mutation delivery.
// Anything that needs real layout (composer measurement, ResizeObserver) belongs
// in the Electron fixture instead.

function parse(selector) {
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/);
      if (!match) throw new Error(`fake-dom: unsupported selector "${part}"`);
      return { tag: match[1] ? match[1].toUpperCase() : null, tokens: match[2].match(/[.#][\w-]+|\[[^\]]+\]/g) || [] };
    });
}

function matchesOne(element, { tag, tokens }) {
  if (tag && element.tagName !== tag) return false;
  for (const token of tokens) {
    if (token[0] === '.') {
      if (!element.classList.contains(token.slice(1))) return false;
    } else if (token[0] === '#') {
      if (element.id !== token.slice(1)) return false;
    } else {
      const attribute = token.slice(1, -1).match(/^([\w-]+)(?:=["']?([^"']*)["']?)?$/);
      if (!attribute) return false;
      const value = element.getAttribute(attribute[1]);
      if (value === null) return false;
      if (attribute[2] !== undefined && value !== attribute[2]) return false;
    }
  }
  return true;
}

class FakeText {
  constructor(doc, value) {
    this.doc = doc;
    this.nodeType = 3;
    this.parentElement = null;
    this.value = value;
  }
  get nodeValue() {
    return this.value;
  }
  set nodeValue(next) {
    if (next === this.value) return;
    this.value = next;
    this.doc.record({ type: 'characterData', target: this, addedNodes: [], removedNodes: [] });
  }
  get isConnected() {
    return !!this.parentElement?.isConnected;
  }
}

class FakeElement {
  constructor(doc, tag) {
    this.doc = doc;
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.childNodes = [];
    this.parentElement = null;
    this.attributes = new Map();
    const element = this;
    this.classList = {
      contains: (name) => (element.getAttribute('class') || '').split(/\s+/).includes(name),
      add(name) {
        if (this.contains(name)) return;
        element.setAttribute('class', `${element.getAttribute('class') || ''} ${name}`.trim());
      },
      remove(name) {
        element.setAttribute(
          'class',
          (element.getAttribute('class') || '')
            .split(/\s+/)
            .filter((entry) => entry && entry !== name)
            .join(' '),
        );
      },
    };
  }
  get id() {
    return this.getAttribute('id') || '';
  }
  set id(value) {
    this.setAttribute('id', value);
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  get isConnected() {
    let node = this;
    while (node.parentElement) node = node.parentElement;
    return node === this.doc.documentElement;
  }
  get textContent() {
    return this.childNodes.map((node) => (node.nodeType === 3 ? node.nodeValue : node.textContent)).join('');
  }
  set textContent(value) {
    const removedNodes = this.childNodes;
    for (const node of removedNodes) node.parentElement = null;
    this.childNodes = [];
    const addedNodes = [];
    if (value !== '') {
      const text = new FakeText(this.doc, String(value));
      text.parentElement = this;
      this.childNodes.push(text);
      addedNodes.push(text);
    }
    this.doc.record({ type: 'childList', target: this, addedNodes, removedNodes });
  }
  append(...nodes) {
    const addedNodes = nodes.map((node) => (typeof node === 'string' ? new FakeText(this.doc, node) : node));
    for (const node of addedNodes) {
      node.parentElement?.removeChild(node);
      node.parentElement = this;
      this.childNodes.push(node);
    }
    this.doc.record({ type: 'childList', target: this, addedNodes, removedNodes: [] });
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index === -1) return;
    this.childNodes.splice(index, 1);
    node.parentElement = null;
    this.doc.record({ type: 'childList', target: this, addedNodes: [], removedNodes: [node] });
  }
  remove() {
    this.parentElement?.removeChild(this);
  }
  matches(selector) {
    return parse(selector).some((part) => matchesOne(this, part));
  }
  closest(selector) {
    const parts = parse(selector);
    let node = this;
    while (node) {
      if (parts.some((part) => matchesOne(node, part))) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const parts = parse(selector);
    const found = [];
    const walk = (element) => {
      for (const node of element.childNodes) {
        if (node.nodeType !== 1) continue;
        if (parts.some((part) => matchesOne(node, part))) found.push(node);
        walk(node);
      }
    };
    walk(this);
    return found;
  }
}

class FakeDocument {
  constructor() {
    this.nodeType = 9;
    this.readyState = 'complete';
    this.observers = new Set();
    this.pending = [];
    this.flushing = false;
    this.listeners = new Map();
    this.documentElement = new FakeElement(this, 'html');
    this.head = new FakeElement(this, 'head');
    this.body = new FakeElement(this, 'body');
    this.documentElement.append(this.head, this.body);
    this.pending = [];
  }
  createElement(tag) {
    return new FakeElement(this, tag);
  }
  createTextNode(value) {
    return new FakeText(this, value);
  }
  getElementById(id) {
    return this.documentElement.querySelectorAll(`#${id}`)[0] || null;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  record(mutation) {
    this.pending.push(mutation);
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => {
      this.flushing = false;
      this.flush();
    });
  }
  // Tests await this instead of a real event loop turn.
  flush() {
    const records = this.pending;
    this.pending = [];
    if (!records.length) return;
    for (const observer of this.observers) {
      const visible = records.filter((record) => record.type !== 'characterData' || observer.characterData);
      if (visible.length) observer.callback(visible);
    }
  }
  createTreeWalker(root, _show, filter) {
    const nodes = [];
    const walk = (node) => {
      for (const child of node.nodeType === 9 ? [node.documentElement] : node.childNodes) {
        if (child.nodeType === 3) {
          if (filter.acceptNode(child) !== 2) nodes.push(child);
        } else if (child.nodeType === 1) walk(child);
      }
    };
    if (root.nodeType === 3) {
      if (filter.acceptNode(root) !== 2) nodes.push(root);
    } else walk(root);
    let index = 0;
    return { nextNode: () => (index < nodes.length ? nodes[index++] : null) };
  }
}

function createWorld(extra = {}) {
  const document = new FakeDocument();
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.characterData = false;
    }
    observe(_target, options) {
      this.characterData = options?.characterData === true;
      document.observers.add(this);
    }
    disconnect() {
      document.observers.delete(this);
    }
  }
  return {
    document,
    MutationObserver,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    queueMicrotask,
    setTimeout,
    ...extra,
  };
}

module.exports = { createWorld, FakeDocument, FakeElement, FakeText };
