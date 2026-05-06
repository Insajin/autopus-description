import type {
  Adapter,
  AdapterApplyResult,
  AdapterContext,
  ManifestEntry,
  UndoDescriptor,
  WriteTarget,
} from "./types.js";
import { ERROR_CODES, WriteRouterError } from "./types.js";
import * as annotationCard from "./adapters/annotation-card.js";
import * as comment from "./adapters/comment.js";
import * as descriptionsPage from "./adapters/descriptions-page.js";
import * as pluginData from "./adapters/plugin-data.js";
import * as frameName from "./adapters/frame-name.js";
import * as noneAdapterMod from "./adapters/none.js";

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

// Dynamic-dispatch adapter wrappers: each wrapper looks up the named export on
// the adapter module at call time so that vi.spyOn(adaptersModule, "applyXxx")
// installed in tests is observed by the router. Plain object adapters that
// snapshot the function reference at module load do not honor spies.
type ApplyFn = (entry: ManifestEntry, ctx: AdapterContext) => Promise<AdapterApplyResult>;
type UndoFn = (descriptor: UndoDescriptor, ctx: AdapterContext) => Promise<void>;

function dynamicAdapter(
  ns: { [k: string]: unknown },
  applyKey: string,
  undoKey: string,
): Adapter {
  return {
    apply: (entry, ctx) => (ns[applyKey] as ApplyFn)(entry, ctx),
    undo: (descriptor, ctx) => (ns[undoKey] as UndoFn)(descriptor, ctx),
  };
}

// W2 default registrations: all six write_target enum values resolve to
// concrete adapter implementations via module-namespace dynamic dispatch.
// Constructor-supplied `initial` overrides still take precedence so
// integration tests can swap any adapter for a spy.
const defaultAdapters: Partial<Record<WriteTarget, Adapter>> = {
  annotation_card: dynamicAdapter(
    annotationCard as { [k: string]: unknown },
    "applyAnnotationCard",
    "undoAnnotationCard",
  ),
  comment: dynamicAdapter(
    comment as { [k: string]: unknown },
    "applyComment",
    "undoComment",
  ),
  descriptions_page: dynamicAdapter(
    descriptionsPage as { [k: string]: unknown },
    "applyDescriptionsPage",
    "undoDescriptionsPage",
  ),
  plugin_data: dynamicAdapter(
    pluginData as { [k: string]: unknown },
    "applyPluginData",
    "undoPluginData",
  ),
  frame_name: dynamicAdapter(
    frameName as { [k: string]: unknown },
    "applyFrameName",
    "undoFrameName",
  ),
  none: dynamicAdapter(
    noneAdapterMod as { [k: string]: unknown },
    "applyNone",
    "undoNone",
  ),
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
