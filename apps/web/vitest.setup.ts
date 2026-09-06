// ────────────────────────────────────────────────────────────────
// Web test environment shims.
//
// The jest-dom matchers are registered here and nowhere else. Without this
// import every `toBeInTheDocument` / `toHaveTextContent` / `toBeDisabled`
// assertion fails as `Invalid Chai property` — 48 failures across 12 files,
// all of them the assertion library rather than the component under test.
//
// jsdom does not implement `matchMedia` at all, and under Node 26 its
// `localStorage` is shadowed by Node's own global — which is `undefined`
// unless the process was started with `--localstorage-file`. Both surface as
// crashes at module load, before a single assertion runs.
//
// These are the two APIs the SPA touches during import: `authRuntime` reads
// the endpoint override from storage, and `ThemeProvider` asks for the
// system colour scheme.
// ────────────────────────────────────────────────────────────────

import '@testing-library/jest-dom/vitest';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

function installStorage(name: 'localStorage' | 'sessionStorage'): void {
  const existing = (window as unknown as Record<string, unknown>)[name];
  if (existing && typeof (existing as Storage).getItem === 'function') return;
  const storage = new MemoryStorage();
  Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
}

installStorage('localStorage');
installStorage('sessionStorage');

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

// jsdom implements no scrolling at all, so `scrollIntoView` is missing.
// RightPane calls it in an effect to keep the selected tab in view, which
// took down every case in its file with a TypeError from the effect.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value(): void {},
  });
}

// jsdom has no `ResizeObserver`, and RightPane constructs one to drive its
// drag-resize. The reference error fires inside a passive effect, so React
// reports it as a render failure and every case in the file fails at once
// with nothing to do with what it was asserting.
if (typeof globalThis.ResizeObserver === 'undefined') {
  // A no-op is right here: jsdom never lays anything out, so a faithful
  // implementation would report zero-sized boxes forever anyway.
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// jsdom's `Blob` predates `arrayBuffer()`, which the artifact download path
// uses to turn a response into a `Uint8Array`.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    writable: true,
    value(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}
