import type { Adapter, WriteTarget } from "./types.js";
import { ERROR_CODES, WriteRouterError } from "./types.js";
import { annotationCardAdapter } from "./adapters/annotation-card.js";
import { commentAdapter } from "./adapters/comment.js";
import { descriptionsPageAdapter } from "./adapters/descriptions-page.js";
import { pluginDataAdapter } from "./adapters/plugin-data.js";
import { frameNameAdapter } from "./adapters/frame-name.js";
import { noneAdapter } from "./adapters/none.js";

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

// W2 default registrations: all six write_target enum values now resolve to
// concrete adapter implementations. Register-time overrides via the
// AdapterRegistry constructor's `initial` argument still take precedence so
// integration tests can swap any adapter for a spy.
const defaultAdapters: Partial<Record<WriteTarget, Adapter>> = {
  annotation_card: annotationCardAdapter,
  comment: commentAdapter,
  descriptions_page: descriptionsPageAdapter,
  plugin_data: pluginDataAdapter,
  frame_name: frameNameAdapter,
  none: noneAdapter,
};

export class AdapterRegistry {
  private readonly adapters = new Map<WriteTarget, Adapter>();

  constructor(initial?: Partial<Record<WriteTarget, Adapter>>) {
    for (const t of TARGETS) {
      const adapter =
        initial?.[t] ?? defaultAdapters[t] ?? notImplementedAdapter(t);
      this.adapters.set(t, adapter);
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
