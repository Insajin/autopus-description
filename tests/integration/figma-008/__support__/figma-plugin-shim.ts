/**
 * SPEC-FIGMA-008 — figma plugin globals shim for AC-T5 / AC-T7 / AC-T8.
 *
 * The Figma plugin runtime exposes `figma.clientStorage` (origin-isolated
 * IndexedDB) and `figma.currentPage.getPluginData / setPluginData`
 * (file-shared plaintext). The vendor patch under
 * `vendor/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/` calls these.
 *
 * Tests cannot run inside Figma's sandbox; this shim provides a hermetic,
 * in-memory stand-in with the same surface the vendor patch will consume.
 *
 * Two shapes are exported:
 *   - {@link FigmaPluginShim} — installs a `figma` global compatible with
 *     vendor-side code that reads `figma.clientStorage` / `figma.currentPage`.
 *   - {@link PluginStorageBridge} — daemon-side port-mock adapter exposing
 *     `pluginData` (Map) + `clientStorage` (IndexedDB-shaped) used by
 *     daemon tests that don't pretend to BE the plugin runtime.
 *
 * INV-T6 oracle (AC-T8): the shim MUST NOT silently mirror raw bearers from
 * `clientStorage` into `pluginData`. Tests that violate this would mask the
 * unrecoverability invariant. The shim therefore enforces strict separation.
 */

export interface ClientStorage {
  getAsync(key: string): Promise<string | undefined>;
  setAsync(key: string, value: string): Promise<void>;
  deleteAsync(key: string): Promise<void>;
  keysAsync(): Promise<string[]>;
}

export interface CurrentPagePluginData {
  getPluginData(key: string): string;
  setPluginData(key: string, value: string): void;
  getPluginDataKeys(): string[];
}

export interface FigmaGlobalShape {
  clientStorage: ClientStorage;
  currentPage: CurrentPagePluginData;
}

class InMemoryClientStorage implements ClientStorage {
  private readonly store = new Map<string, string>();
  async getAsync(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  async setAsync(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async deleteAsync(key: string): Promise<void> {
    this.store.delete(key);
  }
  async keysAsync(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

class InMemoryPluginData implements CurrentPagePluginData {
  // INV-T6: pluginData is plaintext, file-shared. Test reads MUST observe
  // exactly what the vendor patch wrote — no implicit mirroring from
  // clientStorage, no silent coercion.
  readonly map = new Map<string, string>();
  getPluginData(key: string): string {
    return this.map.get(key) ?? "";
  }
  setPluginData(key: string, value: string): void {
    if (value === "") {
      this.map.delete(key);
      return;
    }
    this.map.set(key, value);
  }
  getPluginDataKeys(): string[] {
    return [...this.map.keys()];
  }
}

/**
 * Installs `globalThis.figma` for the duration of the calling test. Returns a
 * disposer that restores the previous binding (usually `undefined`).
 */
export class FigmaPluginShim {
  readonly clientStorage = new InMemoryClientStorage();
  readonly currentPage = new InMemoryPluginData();

  install(): () => void {
    const prev = (globalThis as { figma?: FigmaGlobalShape }).figma;
    (globalThis as { figma?: FigmaGlobalShape }).figma = {
      clientStorage: this.clientStorage,
      currentPage: this.currentPage,
    };
    return () => {
      (globalThis as { figma?: FigmaGlobalShape }).figma = prev;
    };
  }
}

/**
 * Daemon-side bridge adapter. Daemon code that needs to verify plugin storage
 * shape — without pretending to BE the plugin — accepts this `pluginData`
 * Map + `clientStorage` getter pair.
 */
export interface PluginStorageBridge {
  readonly pluginData: Map<string, string>;
  readonly clientStorage: ClientStorage;
}

export function bridgeFromShim(shim: FigmaPluginShim): PluginStorageBridge {
  return {
    pluginData: shim.currentPage.map,
    clientStorage: shim.clientStorage,
  };
}
