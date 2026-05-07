// SPEC-FIGMA-008 — Backward-compat shim. The canonical surface lives in
// `./plugin-port.ts` (PluginPort interface + InMemoryPluginPort + the
// existing test fakes PluginStatusStripPort/PluginStorageMock). This file
// re-exports those test fakes so legacy callers that imported from here
// continue to work.

export {
  PluginStatusStripPort,
  PluginStorageMock,
} from "./plugin-port.js";
