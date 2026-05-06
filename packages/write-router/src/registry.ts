import type { Adapter, WriteTarget } from "./types.js";
import { ERROR_CODES, WriteRouterError } from "./types.js";

const TARGETS: WriteTarget[] = [
  "annotation_card",
  "descriptions_page",
  "comment",
  "plugin_data",
  "frame_name",
  "none",
];

function notImplementedAdapter(target: WriteTarget): Adapter {
  return {
    async apply() {
      throw new WriteRouterError(
        ERROR_CODES.NOT_IMPLEMENTED,
        `${target} adapter not implemented in W1`,
      );
    },
    async undo() {
      throw new WriteRouterError(
        ERROR_CODES.NOT_IMPLEMENTED,
        `${target} adapter undo not implemented in W1`,
      );
    },
  };
}

export class AdapterRegistry {
  private readonly adapters = new Map<WriteTarget, Adapter>();

  constructor(initial?: Partial<Record<WriteTarget, Adapter>>) {
    for (const t of TARGETS) {
      this.adapters.set(t, initial?.[t] ?? notImplementedAdapter(t));
    }
  }

  register(target: WriteTarget, adapter: Adapter): void {
    this.adapters.set(target, adapter);
  }

  resolve(target: WriteTarget): Adapter {
    const adapter = this.adapters.get(target);
    if (!adapter) {
      throw new WriteRouterError(
        ERROR_CODES.WRITE_TARGET_ROUTING_ERROR,
        `unknown write_target: ${target}`,
      );
    }
    return adapter;
  }

  has(target: WriteTarget): boolean {
    return this.adapters.has(target);
  }

  size(): number {
    return this.adapters.size;
  }

  list(): WriteTarget[] {
    return [...this.adapters.keys()];
  }
}

export const KNOWN_TARGETS = TARGETS;
