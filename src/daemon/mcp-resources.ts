// SPEC-FIGMA-006 REQ-05, INV-004: MCP resource registry with 4 fixed URIs.
// active_selection: most-recently-published frame description (5-key shape)
// pending_descriptions: bounded queue of recent publishes (max 30)
// audit_events: ring of recent audit rows (read-only mirror)
// stale_frames: frames whose current source_hash differs from last published

export interface ActiveSelection {
  frame_id: string;
  screen_id: string;
  source_hash: string;
  generated_at: string;
  description: string;
}

export interface StaleFrameEntry {
  frame_id: string;
  last_published_source_hash: string;
  current_source_hash: string;
}

export interface ResourceListItem {
  uri: string;
  name: string;
}

// @AX:NOTE: [AUTO] 4 URI strings are external contract — `autopus://active_selection`, `autopus://pending_descriptions`, `autopus://audit_events`, `autopus://stale_frames` (REQ-05/INV-004). Renaming breaks plugin clients.
const URI_LIST: ResourceListItem[] = [
  { uri: "autopus://active_selection", name: "active_selection" },
  { uri: "autopus://pending_descriptions", name: "pending_descriptions" },
  { uri: "autopus://audit_events", name: "audit_events" },
  { uri: "autopus://stale_frames", name: "stale_frames" },
];

// @AX:NOTE: [AUTO] PENDING_LIMIT=30 magic constant — bounds pending_descriptions ring; raising affects memory budget asserted by NFR (256MB rss_mb cap).
const PENDING_LIMIT = 30;

export class McpResources {
  private active: ActiveSelection | null = null;
  private pending: ActiveSelection[] = [];
  private auditEvents: unknown[] = [];
  private stale: StaleFrameEntry[] = [];
  // Frame_id -> most-recently-published source_hash.
  private publishedHashes = new Map<string, string>();

  async list(): Promise<ResourceListItem[]> {
    return [...URI_LIST];
  }

  // @AX:ANCHOR: [AUTO] sole MCP resource read dispatcher — switches across all 4 URIs; new resources MUST be added here AND to URI_LIST. @AX:REASON: drift between URI_LIST and read() switch breaks AC-S7 resource discovery.
  async read(uri: string): Promise<any> {
    switch (uri) {
      case "autopus://active_selection":
        return this.active ?? {};
      case "autopus://pending_descriptions":
        return [...this.pending];
      case "autopus://audit_events":
        return [...this.auditEvents];
      case "autopus://stale_frames":
        return [...this.stale];
      default:
        throw new Error("Unknown resource URI");
    }
  }

  async publish(entry: ActiveSelection): Promise<void> {
    this.active = { ...entry };
    this.pending.push({ ...entry });
    if (this.pending.length > PENDING_LIMIT) {
      this.pending = this.pending.slice(this.pending.length - PENDING_LIMIT);
    }
    this.publishedHashes.set(entry.frame_id, entry.source_hash);
    // A fresh publish for a frame clears any stale marker for it.
    this.stale = this.stale.filter((s) => s.frame_id !== entry.frame_id);
  }

  /**
   * Mark a frame stale when its current source_hash differs from the last
   * published one. If no publish ever happened for the frame, this is a
   * no-op (we cannot make a stale claim without a baseline).
   */
  async markStale(input: { frame_id: string; current_source_hash: string }): Promise<void> {
    const last = this.publishedHashes.get(input.frame_id);
    if (!last) return;
    if (last === input.current_source_hash) return;
    // Replace any existing entry for this frame_id so the latest current_source_hash wins.
    this.stale = this.stale.filter((s) => s.frame_id !== input.frame_id);
    this.stale.push({
      frame_id: input.frame_id,
      last_published_source_hash: last,
      current_source_hash: input.current_source_hash,
    });
  }

  recordAuditEvent(row: unknown): void {
    this.auditEvents.push(row);
    if (this.auditEvents.length > 100) {
      this.auditEvents = this.auditEvents.slice(this.auditEvents.length - 100);
    }
  }

  /** Get the last published source_hash for a frame_id (read-only access). */
  getPublishedHash(frame_id: string): string | undefined {
    return this.publishedHashes.get(frame_id);
  }
}
