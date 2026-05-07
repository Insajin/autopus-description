// SPEC-FIGMA-005 T6: screenshot_sha256 → file_id cache for Files API dedup.
// REQ-04, REQ-21. Same screenshot uploaded once per pipeline run; subsequent
// Vision calls reuse the file_id, billing image_input_tokens = 0 on the
// second call (verified by AC-S3).
//
// Cache scope is one pipeline run. The map persists to
// .audit/<batch_id>/file-id-map.json so worker boundaries inside semaphoreMap
// can recover the mapping after a crash-restart, but the cache is NOT shared
// across distinct pipeline runs (file_id retention is bounded by the
// Anthropic Files API quota window — see OI-005.2).

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export interface FileIdEntry {
  file_id: string;
  uploaded_at: string;
}

/**
 * In-memory mapping of screenshot_sha256 → file_id with optional persistence.
 *
 * Thread-safe within Node single-thread: Map.get/set are atomic w.r.t.
 * concurrent semaphoreMap workers. No additional locking required.
 *
 * Dedup count = total Vision calls − unique file_ids uploaded. Reported to
 * stdout aggregate summary (REQ-22, AC-S4).
 */
export class FileIdCache {
  private readonly map = new Map<string, FileIdEntry>();
  private totalLookups = 0;
  private uniqueUploads = 0;

  /**
   * Returns the cached file_id for the given screenshot sha256, or undefined
   * when no upload has been recorded yet. Always increments the lookup
   * counter so dedup ratio reflects every Vision call.
   */
  get(sha256: string): string | undefined {
    this.totalLookups++;
    return this.map.get(sha256)?.file_id;
  }

  /**
   * Record a file_id for a screenshot sha256. Only the first set() per
   * sha256 counts toward uniqueUploads — subsequent set() calls (e.g., from
   * a re-upload retry) keep the original file_id by-design (file_id is
   * deterministic only across uploads of identical bytes; we lock it).
   */
  set(sha256: string, file_id: string): void {
    if (this.map.has(sha256)) return;
    this.map.set(sha256, {
      file_id,
      uploaded_at: new Date().toISOString(),
    });
    this.uniqueUploads++;
  }

  has(sha256: string): boolean {
    return this.map.has(sha256);
  }

  /**
   * Number of dedup-saved upload calls = total Vision calls − unique uploads.
   * AC-S4 oracle: 10 calls with 5 unique sha256 ⇒ dedup count = 5.
   */
  getDedupCount(): number {
    return this.totalLookups - this.uniqueUploads;
  }

  /**
   * Snapshot of all sha256 → file_id pairs. Used by the persistence helper
   * and by AC-S4 to assert the persisted file size.
   */
  entries(): Array<[string, FileIdEntry]> {
    return Array.from(this.map.entries());
  }

  size(): number {
    return this.map.size;
  }

  /**
   * Persist the current map under .audit/<batch_id>/file-id-map.json.
   * Idempotent — overwrites the existing file each call.
   */
  persist(audit_dir: string, batch_id: string): string {
    const path = join(audit_dir, batch_id, "file-id-map.json");
    mkdirSync(dirname(path), { recursive: true });
    const payload = {
      schema_version: "1.0",
      batch_id,
      entries: Object.fromEntries(this.map),
    };
    writeFileSync(path, JSON.stringify(payload, null, 2), "utf-8");
    return path;
  }

  /**
   * Load a previously-persisted map. Used to recover from crash-restart.
   * Missing file is silently treated as empty (cold start).
   */
  load(audit_dir: string, batch_id: string): void {
    const path = join(audit_dir, batch_id, "file-id-map.json");
    if (!existsSync(path)) return;
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as {
      entries?: Record<string, FileIdEntry>;
    };
    const entries = parsed.entries ?? {};
    for (const [sha, entry] of Object.entries(entries)) {
      if (!this.map.has(sha)) {
        this.map.set(sha, entry);
        this.uniqueUploads++;
      }
    }
  }
}
