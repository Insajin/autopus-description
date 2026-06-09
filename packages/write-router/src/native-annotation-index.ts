// SPEC-FIGMA-018 T4 helper — build a name→id node index from scan results.
// Extracted from the adapter to keep each file under the 300-line hard limit
// (NFR-01) and to isolate the scan-shape parsing concern.

export interface ScanNode {
  id: string;
  name: string;
}

interface ScanResult {
  nodes?: unknown;
}

// Tolerant parse of the client `scan` payload into a name→id record. Nodes
// missing an id or name are skipped; the index feeds the pure resolveAreaNode.
export function buildNodeIndex(scanResult: unknown): Record<string, string> {
  const index: Record<string, string> = {};
  const nodes = (scanResult as ScanResult | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return index;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const candidate = node as Partial<ScanNode>;
    if (typeof candidate.id === "string" && typeof candidate.name === "string") {
      index[candidate.name] = candidate.id;
    }
  }
  return index;
}
