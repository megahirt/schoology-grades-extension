// html-dom.js — parse an HTML string into a minimal DOM that parser-core.js
// can walk, for places with no DOMParser (the MV3 service worker, Node tests).
//
// Why parse5: it implements the WHATWG HTML parsing algorithm, so it builds
// the SAME tree a browser builds. The previous parser (node-html-parser) is
// not spec-compliant; on real Schoology grade reports (~380 KB) it lost track
// of nesting and dropped 100 of 136 assignment rows out of their courses,
// which made a child with a 55% class read as GO.
//
// The wrapper implements only what parser-core.js uses:
//   nodeType, childNodes, getAttribute(name), textContent,
//   querySelector(sel), querySelectorAll(sel)
// Selectors: descendant combinations of compound selectors made of an
// optional tag name, an optional #id and any number of .classes
// (".title-column .title", "tr.item-row", "a"). Anything else throws, so an
// unsupported selector fails loudly in tests instead of matching nothing.

import { parse } from 'parse5';

const ELEMENT = 1;
const TEXT = 3;

function parseCompound(src) {
  const m = src.match(/^([a-zA-Z][\w-]*)?((?:[#.][\w-]+)*)$/);
  if (!m || (!m[1] && !m[2])) throw new Error(`html-dom: unsupported selector "${src}"`);
  const tag = m[1] ? m[1].toLowerCase() : null;
  let id = null;
  const classes = [];
  for (const part of m[2].match(/[#.][\w-]+/g) || []) {
    if (part[0] === '#') id = part.slice(1);
    else classes.push(part.slice(1));
  }
  return { tag, id, classes };
}

const selectorCache = new Map();
function compile(selector) {
  let compiled = selectorCache.get(selector);
  if (!compiled) {
    const parts = selector.trim().split(/\s+/);
    if (parts.some((p) => /[>+~,[\]:*]/.test(p))) throw new Error(`html-dom: unsupported selector "${selector}"`);
    compiled = parts.map(parseCompound);
    selectorCache.set(selector, compiled);
  }
  return compiled;
}

class Node {
  constructor(raw, parent) {
    this.raw = raw;
    this.parentNode = parent;
    this.nodeType = raw.nodeName === '#text' ? TEXT : raw.tagName ? ELEMENT : 0;
    this._children = null;
    this._classes = null;
  }

  get childNodes() {
    if (!this._children) {
      const kids = this.raw.childNodes || [];
      this._children = kids
        .filter((k) => k.nodeName === '#text' || k.tagName)
        .map((k) => new Node(k, this));
    }
    return this._children;
  }

  get tagName() {
    return this.raw.tagName || null;
  }

  getAttribute(name) {
    const attrs = this.raw.attrs || [];
    const a = attrs.find((x) => x.name === name);
    return a ? a.value : null;
  }

  get classList() {
    if (!this._classes) this._classes = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
    return this._classes;
  }

  get textContent() {
    if (this.nodeType === TEXT) return this.raw.value || '';
    let out = '';
    for (const c of this.childNodes) out += c.textContent;
    return out;
  }

  matchesCompound({ tag, id, classes }) {
    if (this.nodeType !== ELEMENT) return false;
    if (tag && this.raw.tagName !== tag) return false;
    if (id && this.getAttribute('id') !== id) return false;
    for (const c of classes) if (!this.classList.has(c)) return false;
    return true;
  }

  // Matches the full descendant selector, with `scope` as the outer bound
  // (like element.querySelectorAll: ancestors above scope still count, as in
  // the DOM, so ".a .b" from inside .a works).
  matches(compiled) {
    if (!this.matchesCompound(compiled[compiled.length - 1])) return false;
    let i = compiled.length - 2;
    let p = this.parentNode;
    while (i >= 0 && p) {
      if (p.matchesCompound(compiled[i])) i -= 1;
      p = p.parentNode;
    }
    return i < 0;
  }

  *descendants() {
    for (const c of this.childNodes) {
      if (c.nodeType !== ELEMENT) continue;
      yield c;
      yield* c.descendants();
    }
  }

  querySelectorAll(selector) {
    const compiled = compile(selector);
    const out = [];
    for (const d of this.descendants()) if (d.matches(compiled)) out.push(d);
    return out;
  }

  querySelector(selector) {
    const compiled = compile(selector);
    for (const d of this.descendants()) if (d.matches(compiled)) return d;
    return null;
  }
}

// parseHtml(html) -> a document-like root Node.
export function parseHtml(html) {
  const doc = parse(typeof html === 'string' ? html : '');
  const root = new Node(doc, null);
  root.nodeType = 9; // document
  return root;
}
