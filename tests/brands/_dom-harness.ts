import type { ReactNode } from 'react';
import { act } from 'react';
import type { Root } from 'react-dom/client';

let cachedCreateRoot: ((container: Element) => Root) | null = null;

class FakeEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  defaultPrevented = false;
  cancelBubble = false;
  target: FakeNode | null = null;
  currentTarget: FakeNode | null = null;
  key = '';
  shiftKey = false;
  ctrlKey = false;
  metaKey = false;

  constructor(
    type: string,
    init?: {
      bubbles?: boolean;
      cancelable?: boolean;
      key?: string;
      shiftKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
    },
  ) {
    this.type = type;
    this.bubbles = init?.bubbles ?? true;
    this.cancelable = init?.cancelable ?? true;
    this.key = init?.key ?? '';
    this.shiftKey = Boolean(init?.shiftKey);
    this.ctrlKey = Boolean(init?.ctrlKey);
    this.metaKey = Boolean(init?.metaKey);
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {
    this.cancelBubble = true;
  }

  stopImmediatePropagation() {
    this.cancelBubble = true;
  }
}

class FakeNode {
  nodeType: number;
  nodeName: string;
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  ownerDocument: FakeDocument | null = null;
  _listeners = new Map<string, Set<(ev: FakeEvent) => void>>();

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): FakeNode | null {
    if (!this.parentNode) return null;
    const idx = this.parentNode.childNodes.indexOf(this);
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null;
  }

  appendChild<T extends FakeNode>(child: T): T {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument ?? (this instanceof FakeDocument ? this : null);
    this.childNodes.push(child);
    return child;
  }

  insertBefore<T extends FakeNode>(child: T, ref: FakeNode | null): T {
    if (!ref) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument = this.ownerDocument ?? (this instanceof FakeDocument ? this : null);
    const idx = this.childNodes.indexOf(ref);
    if (idx === -1) this.childNodes.push(child);
    else this.childNodes.splice(idx, 0, child);
    return child;
  }

  removeChild<T extends FakeNode>(child: T): T {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) this.childNodes.splice(idx, 1);
    child.parentNode = null;
    return child;
  }

  addEventListener(type: string, fn: (ev: FakeEvent) => void) {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (ev: FakeEvent) => void) {
    this._listeners.get(type)?.delete(fn);
  }

  dispatchEvent(ev: FakeEvent): boolean {
    if (!ev.target) ev.target = this;
    let cur: FakeNode | null = this;
    while (cur) {
      ev.currentTarget = cur;
      const listeners = [...(cur._listeners.get(ev.type) ?? [])];
      for (const fn of listeners) fn(ev);
      if (ev.cancelBubble || !ev.bubbles) break;
      cur = cur.parentNode;
    }
    return !ev.defaultPrevented;
  }

  contains(other: FakeNode | null): boolean {
    let cur: FakeNode | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
}

class FakeText extends FakeNode {
  _data: string;
  constructor(data: string) {
    super(3, '#text');
    this._data = String(data);
  }
  get data() {
    return this._data;
  }
  set data(v: string) {
    this._data = String(v);
  }
  get nodeValue() {
    return this._data;
  }
  set nodeValue(v: string) {
    this._data = String(v);
  }
  get textContent() {
    return this._data;
  }
}

function matchesSimpleSelector(el: FakeElement, selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  // Support comma-separated groups or descendant combinators ("a b").
  if (trimmed.includes(',')) {
    return trimmed.split(',').some((part) => matchesSimpleSelector(el, part));
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1]!;
    if (!matchesAtom(el, tail)) return false;
    let cur = el.parentElement;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      const ancestorSel = parts[i]!;
      while (cur && !matchesAtom(cur, ancestorSel)) {
        cur = cur.parentElement;
      }
      if (!cur) return false;
      cur = cur.parentElement;
    }
    return true;
  }
  return matchesAtom(el, parts[0]!);
}

function matchesAtom(el: FakeElement, atom: string): boolean {
  if (atom === '[href]') return el.hasAttribute('href');
  if (atom === ':not([disabled])') return !el.disabled && !el.hasAttribute('disabled');
  // Parse optional tag prefix, classes, and attribute selectors.
  let rest = atom;
  const tagMatch = /^[a-zA-Z0-9_-]+/.exec(rest);
  if (tagMatch) {
    if (el.tagName.toLowerCase() !== tagMatch[0].toLowerCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest.length > 0) {
    if (rest.startsWith(':not([disabled])')) {
      if (el.disabled || el.hasAttribute('disabled')) return false;
      rest = rest.slice(':not([disabled])'.length);
      continue;
    }
    if (rest.startsWith(':not([tabindex="-1"])')) {
      if (el.getAttribute('tabindex') === '-1') return false;
      rest = rest.slice(':not([tabindex="-1"])'.length);
      continue;
    }
    if (rest.startsWith('.')) {
      const cls = /^\.([a-zA-Z0-9_-]+)/.exec(rest);
      if (!cls) return false;
      const classes = (el.getAttribute('class') ?? '').split(/\s+/);
      if (!classes.includes(cls[1]!)) return false;
      rest = rest.slice(cls[0].length);
      continue;
    }
    if (rest.startsWith('[')) {
      // `[name]`, `[name="v"]` and the prefix form `[name^="v"]` (menus collect `[role^="menuitem"]`).
      const attr = /^\[([^\]=^]+)(?:(\^?=)"([^"]*)")?\]/.exec(rest);
      if (!attr) return false;
      const [, name, op, val] = attr;
      if (!el.hasAttribute(name!)) return false;
      if (val !== undefined) {
        const actual = el.getAttribute(name!) ?? '';
        if (op === '^=' ? !actual.startsWith(val) : actual !== val) return false;
      }
      rest = rest.slice(attr[0].length);
      continue;
    }
    return false;
  }
  return true;
}

class FakeElement extends FakeNode {
  tagName: string;
  attributes: Record<string, string> = {};
  style: Record<string, string> & {
    setProperty(k: string, v: string): void;
    removeProperty(k: string): void;
  };
  disabled = false;
  checked = false;
  paused = true;
  currentTime = 0;
  duration = 5;
  _value = '';

  constructor(tag: string) {
    super(1, tag.toUpperCase());
    this.tagName = tag.toUpperCase();
    const styleObj: Record<string, unknown> = {
      setProperty(k: string, v: string) {
        styleObj[k] = v;
      },
      removeProperty(k: string) {
        delete styleObj[k];
      },
    };
    this.style = styleObj as FakeElement['style'];
  }

  get id(): string {
    return this.attributes.id ?? '';
  }

  set id(v: string) {
    this.attributes.id = String(v ?? '');
  }

  get name(): string {
    return this.attributes.name ?? '';
  }

  set name(v: string) {
    this.attributes.name = String(v ?? '');
  }

  get type(): string {
    return this.attributes.type ?? '';
  }

  set type(v: string) {
    this.attributes.type = String(v ?? '');
  }

  pause() {
    this.paused = true;
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  load() {}

  get value(): string {
    return this._value;
  }

  set value(v: string) {
    this._value = String(v ?? '');
  }

  get className(): string {
    return this.attributes.class ?? '';
  }

  set className(v: string) {
    this.attributes.class = String(v ?? '');
  }

  get parentElement(): FakeElement | null {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement);
  }

  setAttribute(name: string, val: string) {
    if (name === 'disabled') this.disabled = true;
    this.attributes[name] = String(val);
  }

  getAttribute(name: string): string | null {
    return name in this.attributes ? this.attributes[name]! : null;
  }

  hasAttribute(name: string): boolean {
    if (name === 'disabled' && this.disabled) return true;
    return name in this.attributes;
  }

  removeAttribute(name: string) {
    if (name === 'disabled') this.disabled = false;
    delete this.attributes[name];
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  scrollIntoView() {}

  getBoundingClientRect() {
    return { top: 0, left: 0, bottom: 20, right: 100, width: 100, height: 20 };
  }

  closest(selector: string): FakeElement | null {
    let cur: FakeElement | null = this;
    while (cur) {
      if (matchesSimpleSelector(cur, selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeNode) => {
      for (const child of node.childNodes) {
        if (child instanceof FakeElement) {
          if (matchesSimpleSelector(child, selector)) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((c) => (c instanceof FakeText || c instanceof FakeElement ? c.textContent : '')).join('');
  }

  set textContent(v: string) {
    this.childNodes = v ? [new FakeText(v)] : [];
  }

  get nodeValue(): null {
    return null;
  }
}

class FakeInputElement extends FakeElement {
  override get value(): string {
    return this._value;
  }
  override set value(v: string) {
    this._value = String(v ?? '');
  }
}
class FakeTextAreaElement extends FakeElement {
  override get value(): string {
    return this._value;
  }
  override set value(v: string) {
    this._value = String(v ?? '');
  }
}
class FakeSelectElement extends FakeElement {
  override get value(): string {
    return this._value;
  }
  override set value(v: string) {
    this._value = String(v ?? '');
  }
}
class FakeButtonElement extends FakeElement {}
class FakeIFrameElement extends FakeElement {}
class FakeSvgElement extends FakeElement {}

class FakeDocument extends FakeNode {
  documentElement: FakeElement;
  body: FakeElement;
  activeElement: FakeNode;
  defaultView: typeof globalThis | null = null;
  HTMLIFrameElement = FakeIFrameElement;
  oninput: unknown = null;
  onchange: unknown = null;

  constructor() {
    super(9, '#document');
    this.documentElement = new FakeElement('html');
    this.body = new FakeElement('body');
    this.documentElement.ownerDocument = this;
    this.body.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.childNodes.push(this.documentElement);
    this.activeElement = this.body;
  }

  createElement(tag: string): FakeElement {
    const lower = tag.toLowerCase();
    const el =
      lower === 'input'
        ? new FakeInputElement(tag)
        : lower === 'textarea'
          ? new FakeTextAreaElement(tag)
          : lower === 'select'
            ? new FakeSelectElement(tag)
            : lower === 'button'
              ? new FakeButtonElement(tag)
              : lower === 'iframe'
                ? new FakeIFrameElement(tag)
                : new FakeElement(tag);
    el.ownerDocument = this;
    return el;
  }

  createElementNS(_ns: string, tag: string): FakeElement {
    const el = new FakeSvgElement(tag);
    el.ownerDocument = this;
    return el;
  }

  createTextNode(text: string): FakeText {
    const node = new FakeText(text);
    node.ownerDocument = this;
    return node;
  }

  createComment(text: string): FakeNode {
    const node = new FakeNode(8, '#comment');
    node.ownerDocument = this;
    void text;
    return node;
  }

  querySelector(selector: string): FakeElement | null {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.body.querySelectorAll(selector);
  }
}

export interface MountedDom {
  container: FakeElement;
  document: FakeDocument;
  rerender(node: ReactNode): Promise<void>;
  query(selector: string): FakeElement | null;
  queryAll(selector: string): FakeElement[];
  click(target: FakeElement | string): Promise<void>;
  setValue(target: FakeElement | string, value: string): Promise<void>;
  submit(target?: FakeElement | string): Promise<void>;
  keyDown(
    key: string,
    opts?: { shiftKey?: boolean; target?: FakeElement | FakeNode | null },
  ): Promise<void>;
  unmount(): Promise<void>;
}

export async function mountDom(node: ReactNode): Promise<MountedDom> {
  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
  const prevAudio = (globalThis as Record<string, unknown>).Audio;
  const prevAddEvt = (globalThis as Record<string, unknown>).addEventListener;
  const prevRemoveEvt = (globalThis as Record<string, unknown>).removeEventListener;
  const prevDispatchEvt = (globalThis as Record<string, unknown>).dispatchEvent;

  const doc = new FakeDocument();
  doc.defaultView = globalThis;
  const windowListeners = new Map<string, Set<(ev: FakeEvent) => void>>();

  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).addEventListener = (type: string, fn: (ev: FakeEvent) => void) => {
    let set = windowListeners.get(type);
    if (!set) {
      set = new Set();
      windowListeners.set(type, set);
    }
    set.add(fn);
  };
  (globalThis as Record<string, unknown>).removeEventListener = (type: string, fn: (ev: FakeEvent) => void) => {
    windowListeners.get(type)?.delete(fn);
  };
  (globalThis as Record<string, unknown>).dispatchEvent = (ev: FakeEvent) => {
    for (const fn of [...(windowListeners.get(ev.type) ?? [])]) fn(ev);
    return !ev.defaultPrevented;
  };
  (globalThis as Record<string, unknown>).Audio = class FakeAudio {
    preload = '';
    src = '';
    pause() {}
    play() {
      return Promise.resolve();
    }
    addEventListener() {}
    removeEventListener() {}
  };
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).Node = FakeNode;
  (globalThis as Record<string, unknown>).Element = FakeElement;
  (globalThis as Record<string, unknown>).HTMLElement = FakeElement;
  (globalThis as Record<string, unknown>).HTMLInputElement = FakeInputElement;
  (globalThis as Record<string, unknown>).HTMLTextAreaElement = FakeTextAreaElement;
  (globalThis as Record<string, unknown>).HTMLSelectElement = FakeSelectElement;
  (globalThis as Record<string, unknown>).HTMLButtonElement = FakeButtonElement;
  (globalThis as Record<string, unknown>).HTMLIFrameElement = FakeIFrameElement;
  (globalThis as Record<string, unknown>).SVGElement = FakeSvgElement;
  if (typeof (globalThis as Record<string, unknown>).ResizeObserver === 'undefined') {
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
  if (typeof (globalThis as Record<string, unknown>).matchMedia === 'undefined') {
    (globalThis as Record<string, unknown>).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
  }
  if (typeof (globalThis as Record<string, unknown>).localStorage === 'undefined') {
    const map = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
    };
  }

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  if (!cachedCreateRoot) {
    const mod = await import('react-dom/client');
    cachedCreateRoot = mod.createRoot;
  }
  let root: Root | null = null;
  await act(async () => {
    root = cachedCreateRoot!(container as unknown as HTMLElement);
    root.render(node);
  });

  const resolve = (target: FakeElement | string): FakeElement => {
    if (typeof target !== 'string') return target;
    const found = doc.querySelector(target);
    if (!found) throw new Error(`Element not found for selector: ${target}`);
    return found;
  };

  const flushMicrotasks = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  return {
    container,
    document: doc,
    async rerender(nextNode: ReactNode) {
      await act(async () => {
        root?.render(nextNode);
      });
    },
    query: (selector: string) => doc.querySelector(selector),
    queryAll: (selector: string) => doc.querySelectorAll(selector),
    async click(target: FakeElement | string) {
      const el = resolve(target);
      el.focus();
      await act(async () => {
        el.dispatchEvent(new FakeEvent('click', { bubbles: true, cancelable: true }));
      });
      await flushMicrotasks();
    },
    async setValue(target: FakeElement | string, value: string) {
      const el = resolve(target);
      const proto = Object.getPrototypeOf(el) as object;
      const setter =
        Object.getOwnPropertyDescriptor(proto, 'value')?.set ??
        Object.getOwnPropertyDescriptor(FakeElement.prototype, 'value')?.set;
      await act(async () => {
        setter?.call(el, value);
        el.dispatchEvent(new FakeEvent('input', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new FakeEvent('change', { bubbles: true, cancelable: true }));
      });
      await flushMicrotasks();
    },
    async submit(target?: FakeElement | string) {
      const form = target ? resolve(target) : resolve('form');
      await act(async () => {
        form.dispatchEvent(new FakeEvent('submit', { bubbles: true, cancelable: true }));
      });
      await flushMicrotasks();
    },
    async keyDown(key, opts) {
      const target = opts?.target ?? doc.activeElement ?? doc.body;
      await act(async () => {
        const ev = new FakeEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key,
          shiftKey: opts?.shiftKey,
        });
        target.dispatchEvent(ev);
        doc.dispatchEvent(
          new FakeEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key,
            shiftKey: opts?.shiftKey,
          }),
        );
        for (const fn of [...(windowListeners.get('keydown') ?? [])]) {
          fn(
            new FakeEvent('keydown', {
              bubbles: true,
              cancelable: true,
              key,
              shiftKey: opts?.shiftKey,
            }),
          );
        }
      });
      await flushMicrotasks();
    },
    async unmount() {
      await act(async () => {
        root?.unmount();
      });
      container.parentNode?.removeChild(container);
      (globalThis as Record<string, unknown>).window = prevWindow;
      (globalThis as Record<string, unknown>).document = prevDocument;
      (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = prevAct;
      (globalThis as Record<string, unknown>).Audio = prevAudio;
      (globalThis as Record<string, unknown>).addEventListener = prevAddEvt;
      (globalThis as Record<string, unknown>).removeEventListener = prevRemoveEvt;
      (globalThis as Record<string, unknown>).dispatchEvent = prevDispatchEvt;
    },
  };
}
