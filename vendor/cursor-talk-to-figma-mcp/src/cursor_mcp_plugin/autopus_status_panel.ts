// SPEC-FIGMA-007 REQ-03, REQ-04, REQ-20 — autopus plugin status panel runtime.
//
// Renders the dryRun preview + Approve/Undo buttons inside the plugin status
// panel. Listens for `dryRun_preview` and `drift_abort` postMessage events
// from the daemon (via the WebSocket bridge → plugin code.js → ui.html
// onmessage). On `[Approve]` click, recomputes `source_hash` via the
// `autopus_source_hash` webcrypto port and emits ONE `apply_request`
// postMessage. REQ-20 forbids any conversational synthesis path other than
// the approve button click.

import { computeSourceHashWebCrypto } from "./autopus_source_hash.js";
import { autopusRedact } from "./autopus_redact.js";

interface PendingPreview {
  pending_id: string;
  manifest_entry_hash: string;
  source_hash_dryrun: string;
  plugin_commands: Array<{ op: string; args: Record<string, unknown> }>;
  frame_id: string;
  write_target: string;
  expires_at: string;
}

interface FrameSelectionState {
  frame_id: string;
  node_tree_summary: unknown;
  image_bytes: Uint8Array;
}

let currentPending: PendingPreview | null = null;
let lastWriteId: string | null = null;
let currentSelection: FrameSelectionState | null = null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function truncateHash(hash: string): string {
  if (hash.length < 16) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

function setHashChip(hash: string): void {
  const el = $("source-hash-chip");
  if (el) el.textContent = truncateHash(hash);
}

function showDriftAbort(): void {
  const el = $("drift-abort");
  if (el) el.classList.add("visible");
}

function hideDriftAbort(): void {
  const el = $("drift-abort");
  if (el) el.classList.remove("visible");
}

function renderPreview(p: PendingPreview): void {
  const container = $("dryrun-preview");
  if (!container) return;
  container.dataset.pendingId = p.pending_id;
  container.innerHTML = "";
  for (const cmd of p.plugin_commands) {
    const row = document.createElement("div");
    row.className = "preview-row";
    const summary = autopusRedact(JSON.stringify(cmd.args)).slice(0, 200);
    row.textContent = `${cmd.op}: ${summary}`;
    container.appendChild(row);
  }
  setHashChip(p.source_hash_dryrun);
  const approve = $("btn-approve") as HTMLButtonElement | null;
  if (approve) {
    approve.disabled = false;
    approve.dataset.pendingId = p.pending_id;
  }
}

function setApproveDisabled(disabled: boolean): void {
  const btn = $("btn-approve") as HTMLButtonElement | null;
  if (btn) btn.disabled = disabled;
}

function setUndoEnabled(write_id: string): void {
  const btn = $("btn-undo") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = false;
    btn.dataset.writeId = write_id;
  }
}

async function recomputeSourceHash(): Promise<string> {
  if (!currentSelection) return "";
  return computeSourceHashWebCrypto({
    node_tree_summary: currentSelection.node_tree_summary,
    image_bytes: currentSelection.image_bytes,
  });
}

// SPEC-FIGMA-007 REQ-20: this is the SOLE production emission site for
// `apply_request`. Anchored to a click event on `[data-action="approve"]`.
async function onApproveClick(): Promise<void> {
  if (!currentPending) return;
  const recomputed = await recomputeSourceHash();
  const payload = {
    type: "apply_request",
    pending_id: currentPending.pending_id,
    source_hash_recomputed: recomputed || currentPending.source_hash_dryrun,
  };
  parent.postMessage({ pluginMessage: payload }, "*");
  setApproveDisabled(true);
}

async function onUndoClick(): Promise<void> {
  const btn = $("btn-undo") as HTMLButtonElement | null;
  const write_id = btn?.dataset.writeId ?? lastWriteId ?? "";
  if (!write_id) return;
  parent.postMessage({ pluginMessage: { type: "undo_request", write_id } }, "*");
}

function handleApplied(write_id: string): void {
  lastWriteId = write_id;
  setUndoEnabled(write_id);
  hideDriftAbort();
}

function handleDryRunPreview(payload: PendingPreview): void {
  currentPending = payload;
  hideDriftAbort();
  renderPreview(payload);
}

function handleDriftAbort(): void {
  showDriftAbort();
  setApproveDisabled(true);
}

function handleSelectionChange(s: FrameSelectionState): void {
  currentSelection = s;
}

window.addEventListener("message", (event) => {
  const data = (event as MessageEvent).data;
  if (!data) return;
  const msg = (data as { pluginMessage?: { type?: string } }).pluginMessage;
  if (!msg || typeof msg !== "object") return;
  const type = (msg as { type?: string }).type;
  if (type === "dryRun_preview") {
    handleDryRunPreview(msg as unknown as PendingPreview & { type: string });
  } else if (type === "drift_abort") {
    handleDriftAbort();
  } else if (type === "apply_completed") {
    const wid = (msg as { write_id?: string }).write_id;
    if (wid) handleApplied(wid);
  } else if (type === "selection_change") {
    handleSelectionChange(msg as unknown as FrameSelectionState);
  }
});

const approveBtn = $("btn-approve");
if (approveBtn) approveBtn.addEventListener("click", onApproveClick);
const undoBtn = $("btn-undo");
if (undoBtn) undoBtn.addEventListener("click", onUndoClick);

export const __test_internals = {
  handleDryRunPreview,
  handleDriftAbort,
  handleApplied,
  handleSelectionChange,
};
