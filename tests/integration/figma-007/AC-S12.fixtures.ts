// SPEC-FIGMA-007 AC-S12 oracle fixture.
//
// 30-frame sequential approve oracle hashes. These constants are LOCKED on
// the first GREEN pass — once captured, any future commit that mutates
// `computeManifestEntryHash`, `computeSourceHash`, or `emitAuditRecord`
// determinism will fail this fixture and the AC-S12 integration test.
//
// First-pass capture protocol:
//   1. Run AC-S12.test.ts with `process.env.AUTOPUS_AC_S12_LOCK = "capture"`.
//   2. The test orchestrator emits the captured values to stdout under a
//      well-known JSON marker; the maintainer copy-pastes them in.
//   3. Replace the placeholder hex constants below with the captured values.
//   4. Commit; future runs verify byte-equality.
//
// Until the capture is performed, the constants below are placeholder
// regex-shaped strings (64 lowercase hex) that the AC-S12 test will
// recognize and fail against (RED state, by design).

export const PLACEHOLDER_HEX_64 =
  "0000000000000000000000000000000000000000000000000000000000000000";

// First and last `prompt_sha256` over the 60-record audit chain (30 read +
// 30 write events). LOCKED 2026-05-07 via `AUTOPUS_AC_S12_LOCK=capture`.
// These byte-equal the daemon-emitter output for the canonical 30-frame
// fixture processed sequentially. Drift in `buildAuditRecord`, `redact`, or
// the apply-tool emitDaemonAudit prompt-text construction will fail this.
export const EXPECTED_FIRST_PROMPT_SHA256 =
  "77dacff19465b7f73e67f3f2d570430a64b272e3ae3c798fd9b266e03c1eb0e2";
export const EXPECTED_LAST_PROMPT_SHA256 =
  "2d3e3b5bb476829f5264e9640c472f4c9940594c8c583b4a5205cb4d043d5b49";

// The 30 distinct manifest_entry_hash values, indexed [0..29] by frame
// order in fixtures/30-frame-mock/frames.json. Asserted pairwise byte-equal
// to the write-router success audit row stream. LOCKED 2026-05-07.
export const EXPECTED_MANIFEST_HASHES: readonly string[] = [
  "14684768ccc0b522eafe3db0092dadae8c6f42d5e3329e6fb458ef007932f689",
  "51c11af0640fd6a499a5e687cc7963c2ba20dba69bfb6a563aa9e93d80693d45",
  "409039c660eb77ad8fcd1cee8fd96df2a5a82359a86eb42be27cfc5b78d32b26",
  "19ebf264767713a17482da450310bf155878fce3ef277265c9f2bc61bc7ce8df",
  "cba271bc281c583bebebbea565eff04004b5602f902c21fee808222c941f5a0f",
  "d78e42030319358e03f6ba57ec493f2e6e0689eb2008bb47ac7598a6a5b5c75b",
  "769c8bea281b1108a43fe770c8b1fc0cef83e847d2d579217e722213d923f44f",
  "945ed04735124e4f18337fdff76629e1c49442eb011f0178d38e93456adb0251",
  "f891aa08c7a5639de4a49af5228b3832856d8fc47af8d200be7854d4f33349ee",
  "0806ac15234d4efa775730028634cf2b910fa42b868dbf6206c0e67103636045",
  "b1cbbe4847ed9f9e1a2d0594178179271dc662beb50bdd62dc7a0ed2b81f0550",
  "e4c6b4860c13599925912ac936a87198fe4a109e20b700778ca8ae67768677e7",
  "a9678a04afd02258f4ae767f03a97e9d0614fcea8719536f92f07f9889a87917",
  "6fd2e393961368c65e9edd1338b1840db9d3c05af96dd24950b9cd8daf90c2cd",
  "4a6ee1ed4dd40b2e6af87013edb00a70b712e7e3a8cd6eba13791e105966582d",
  "30bcb6b4a600129dc8159b004408242ee5fa112049f66f0c1ab0469c0e2c964d",
  "3de1b228c2a36c581a2117c2b1c40cf1867693000127f1c5c1b0e44a88b4bd3f",
  "e8124273e9f82cd041f2bb104edf630679e58c4e6981365619fdec2d4bc6fd9c",
  "d8e0d5637883478a38cb54c5e2470539171c243ecf8a5836b5b8263bce95e266",
  "4329dfb5a195fd6ee46657d3722d7c1f4bc741d032a596028b39411c1ae15bd1",
  "10b411f440fe303ee8712c21b33db6419d2eb64a912b3f266bf775aee5b6964d",
  "11dc47aa44dce2618c25fc4df94cc53626cd87fbd073c565849199e54c15fd06",
  "c5b41e060ac445960fb0b2b3ee1808b19c69b3186cc0b239a303c5b22371031d",
  "f2fe7f41109626a04ebe08c001d3b1c3eebae7ccfd4fcbe3c71f736851fa9856",
  "ca16cc1ee689fd219ad45f1fa2d10a2a67bdb3665ed3b7c478bc387f66283cc1",
  "bd090bf85c308e4edd0807609c48ffd2cd0ea7ba5a50c7506cb32fd1f19fa592",
  "12da4a52683d78833fa5ab378a921b244d3bbaf662d64fab024123f8aee0db8d",
  "51d5495d9f799958238d54954508bac0d3b10b4bbfa5db02991c7a93fed5a82e",
  "81feefe07bf03c3609ba3eaeae61aa0973910ea63827ad9771d3ac55494f3e4f",
  "36437afc272ad2106e6e4a9ff7944e90fe84a2cac58806db34d164e14a126917",
];

// AC-S12 telemetry oracle — every row's exact 11-key set (extends
// SPEC-FIGMA-006's 7-key set with 4 write counters from REQ-11).
export const EXPECTED_TELEMETRY_KEYS_SORTED: readonly string[] = [
  "ai_requery_count",
  "apply_drift_abort_count",
  "approve_count",
  "dryrun_count",
  "dwell_ms",
  "frame_id",
  "generation_ms",
  "rss_mb",
  "selection_to_chat_ms",
  "ts",
  "undo_count",
] as const;

export const NFR01_RSS_BYTES_LIMIT = 268435456; // 256 MiB

// Lock-detection helper for AC-S12. Returns true if the constant set has
// been captured (i.e. is no longer placeholder), false otherwise.
export function isOracleLocked(): boolean {
  if (EXPECTED_FIRST_PROMPT_SHA256 === PLACEHOLDER_HEX_64) return false;
  if (EXPECTED_LAST_PROMPT_SHA256 === PLACEHOLDER_HEX_64) return false;
  return EXPECTED_MANIFEST_HASHES.every((h) => h !== PLACEHOLDER_HEX_64);
}

// Used by `node -e "require('./AC-S12.fixtures.js').assertOracleHashes()"`
// in plan.md verification commands. Throws when placeholders remain.
export function assertOracleHashes(): void {
  if (!isOracleLocked()) {
    throw new Error(
      "SPEC-FIGMA-007 AC-S12 oracle hashes not yet locked — run AC-S12.test.ts in capture mode and commit the captured constants.",
    );
  }
}
