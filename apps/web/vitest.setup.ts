// ────────────────────────────────────────────────────────────────
// Web test environment shims.
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
