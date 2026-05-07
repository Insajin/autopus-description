// SPEC-FIGMA-006 REQ-02, REQ-15: Selection event FIFO queue with same-frame
// debounce coalescing. Within `debounceMs` of the LAST enqueued event for the
// same frame_id, repeat enqueues are suppressed; cross-frame ordering is
// preserved (INV-001).

export interface SelectionPayload {
  readonly figma_node_id: string;
  readonly screen_id: string;
  readonly node_tree_summary: unknown;
  readonly image_bytes_b64_sha256: string;
  readonly image_bytes_b64: string;
}

export interface QueuedEvent {
  readonly frame_id: string;
  readonly screen_id: string;
  readonly source_hash: string;
  readonly accepted_at: number;
  readonly payload: SelectionPayload;
}

export interface SelectionQueueOptions {
  readonly debounceMs?: number;
}

export class SelectionQueue {
  private readonly debounceMs: number;
  private items: QueuedEvent[] = [];
  // Track the last accepted timestamp per frame_id, AND the most recent
  // accepted frame_id, to implement "consecutive same-frame within window
  // collapses" while preserving cross-frame ordering.
  private lastAcceptedFrameId: string | null = null;
  private lastAcceptedAt = 0;

  // @AX:NOTE: [AUTO] 200ms default debounce is the REQ-15 contract — same-frame events within this window collapse, cross-frame ordering preserved (INV-001).
  constructor(opts: SelectionQueueOptions = {}) {
    this.debounceMs = opts.debounceMs ?? 200;
  }

  /** Push a pre-built QueuedEvent (used by crash recovery to rebuild FIFO). */
  push(event: QueuedEvent): void {
    this.items.push(event);
  }

  /**
   * Enqueue a raw selection payload. Returns true if accepted, false if
   * suppressed by the debounce rule (same frame_id as the last accepted
   * event AND within `debounceMs`).
   *
   * The hash is computed lazily by callers — for unit tests that do not
   * provide a real source_hash, we synthesize one from the payload metadata.
   */
  // @AX:NOTE: [AUTO] INV-001 invariant — only LAST-accepted frame_id is tracked; an A→B→A sequence within the window enqueues all three because the comparison is against `lastAcceptedFrameId`, not a per-frame map.
  enqueue(payload: SelectionPayload, sourceHash?: string): QueuedEvent | null {
    const now = Date.now();
    if (
      this.lastAcceptedFrameId === payload.figma_node_id &&
      now - this.lastAcceptedAt < this.debounceMs
    ) {
      return null;
    }
    const event: QueuedEvent = {
      frame_id: payload.figma_node_id,
      screen_id: payload.screen_id,
      source_hash: sourceHash ?? "",
      accepted_at: now,
      payload,
    };
    this.items.push(event);
    this.lastAcceptedFrameId = payload.figma_node_id;
    this.lastAcceptedAt = now;
    return event;
  }

  peek(): QueuedEvent | undefined {
    return this.items[0];
  }

  pop(): QueuedEvent | undefined {
    return this.items.shift();
  }

  toArray(): QueuedEvent[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.lastAcceptedFrameId = null;
    this.lastAcceptedAt = 0;
  }
}
