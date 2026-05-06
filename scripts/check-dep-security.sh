#!/usr/bin/env bash
# SPEC-FIGMA-002 REQ-08 / AC-S5 dependency gate.
#
# Outcomes (these three strings are the AC-S5 oracle and MUST NOT change):
#   - figma-developer-mcp not declared           -> DEPENDENCY_GATE_DORMANT (exit 0)
#   - figma-developer-mcp declared >= 0.6.3      -> DEPENDENCY_GATE_PASS    (exit 0)
#   - figma-developer-mcp declared <  0.6.3      -> DEPENDENCY_GATE_FAIL    (exit 1)
#   - any CVE-2025-53967 advisory in npm audit   -> DEPENDENCY_GATE_FAIL    (exit 1)
#
# FIX-2 (Phase 4 review): replaces the brittle `sort -V` + sed strip approach
# with a 2-pronged check that:
#   (a) prefers the resolved version recorded in package-lock.json (ground
#       truth after `npm install`), falling back to a semver-aware parse of
#       the manifest range when no lockfile exists, so compound ranges like
#       "^0.6" or ">=0.6.3 <0.7.0" no longer mis-trigger DEPENDENCY_GATE_FAIL;
#   (b) ALWAYS runs `npm audit --omit=dev --json` and greps for CVE-2025-53967
#       or any critical advisory whose vulnerability path crosses
#       figma-developer-mcp.

set -uo pipefail

PKG_JSON="${1:-package.json}"
if [ ! -f "${PKG_JSON}" ]; then
  echo "DEPENDENCY_GATE_FAIL: package.json not found at ${PKG_JSON}"
  exit 2
fi

PKG_DIR=$(cd "$(dirname "${PKG_JSON}")" && pwd)
LOCK_JSON="${PKG_DIR}/package-lock.json"

DEP_DECLARED=$(node -e '
const fs=require("fs");
const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const d=(p.dependencies||{})["figma-developer-mcp"];
const dev=(p.devDependencies||{})["figma-developer-mcp"];
const opt=(p.optionalDependencies||{})["figma-developer-mcp"];
process.stdout.write(d||dev||opt||"");
' "${PKG_JSON}")

if [ -z "${DEP_DECLARED}" ]; then
  echo "DEPENDENCY_GATE_DORMANT: figma-developer-mcp not declared (use_figma path)"
  exit 0
fi

# --- (a) Resolve the effective version ----------------------------------------
# Prefer the lockfile (post-install ground truth); fall back to lower-bound
# extraction from the declared range string when no lockfile exists.
RESOLVED_VERSION=""
if [ -f "${LOCK_JSON}" ]; then
  RESOLVED_VERSION=$(node -e '
try {
  const fs=require("fs");
  const lock=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const pkgs=lock.packages||{};
  const direct=pkgs["node_modules/figma-developer-mcp"];
  if (direct && direct.version) { process.stdout.write(direct.version); process.exit(0); }
  const deps=lock.dependencies||{};
  if (deps["figma-developer-mcp"] && deps["figma-developer-mcp"].version) {
    process.stdout.write(deps["figma-developer-mcp"].version); process.exit(0);
  }
  for (const [k,v] of Object.entries(pkgs)) {
    if (k.endsWith("/figma-developer-mcp") && v && v.version) {
      process.stdout.write(v.version); process.exit(0);
    }
  }
} catch {}
' "${LOCK_JSON}")
fi

if [ -z "${RESOLVED_VERSION}" ]; then
  # Fall back to the declared range. Extract the lower-bound version with a
  # semver-aware parser: take the first M.m.p (or M.m, treated as M.m.0) that
  # appears, ignoring leading range operators (^ ~ >= = > <) and whitespace.
  RESOLVED_VERSION=$(node -e '
const r=process.argv[1]||"";
const m=r.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
if (m) {
  const major=parseInt(m[1],10);
  const minor=parseInt(m[2],10);
  const patch=m[3]?parseInt(m[3],10):0;
  process.stdout.write(`${major}.${minor}.${patch}`);
}
' "${DEP_DECLARED}")
fi

if [ -z "${RESOLVED_VERSION}" ]; then
  echo "DEPENDENCY_GATE_FAIL: figma-developer-mcp ${DEP_DECLARED} unparseable (CVE-2025-53967 floor 0.6.3 cannot be verified)"
  exit 1
fi

# Numeric semver compare against 0.6.3 (no `sort -V` — that mishandles
# pre-release and zero-padded segments).
GTE_063=$(node -e '
const v=process.argv[1].split(".").map(s=>parseInt(s,10)||0);
const f=[0,6,3];
const cmp=(a,b)=>a[0]-b[0]||a[1]-b[1]||(a[2]||0)-(b[2]||0);
process.stdout.write(cmp(v,f)>=0?"yes":"no");
' "${RESOLVED_VERSION}")

if [ "${GTE_063}" != "yes" ]; then
  echo "DEPENDENCY_GATE_FAIL: figma-developer-mcp ${DEP_DECLARED} (resolved ${RESOLVED_VERSION}) < 0.6.3 (CVE-2025-53967 command injection)"
  exit 1
fi

# --- (b) npm audit critical / CVE grep ----------------------------------------
if command -v npm >/dev/null 2>&1; then
  AUDIT_JSON=$(cd "${PKG_DIR}" && npm audit --omit=dev --json 2>/dev/null || true)
  if [ -n "${AUDIT_JSON}" ]; then
    # Two grep paths:
    #   1. CVE-2025-53967 anywhere in the JSON (advisory source/url/title)
    #   2. severity=critical AND vulnerability path crosses figma-developer-mcp
    HIT=$(printf '%s' "${AUDIT_JSON}" | node -e '
let raw="";process.stdin.on("data",c=>raw+=c);process.stdin.on("end",()=>{
  try {
    const j=JSON.parse(raw);
    if (raw.includes("CVE-2025-53967")) { process.stdout.write("HIT:CVE"); return; }
    const adv=j.vulnerabilities||{};
    for (const [name, v] of Object.entries(adv)) {
      const sev=(v.severity||"").toLowerCase();
      const via=Array.isArray(v.via)?v.via:[v.via];
      let touchesFigma = name === "figma-developer-mcp";
      for (const w of via) {
        if (typeof w === "string" && w === "figma-developer-mcp") touchesFigma = true;
        if (typeof w === "object" && w && (w.name === "figma-developer-mcp" || (w.source||"").toString().includes("figma-developer-mcp"))) touchesFigma = true;
      }
      if (sev === "critical" && touchesFigma) { process.stdout.write("HIT:CRITICAL"); return; }
    }
  } catch {}
});
')
    case "${HIT}" in
      HIT:CVE)
        echo "DEPENDENCY_GATE_FAIL: npm audit reports CVE-2025-53967 against figma-developer-mcp"
        exit 1
        ;;
      HIT:CRITICAL)
        echo "DEPENDENCY_GATE_FAIL: npm audit reports a critical advisory against figma-developer-mcp"
        exit 1
        ;;
    esac
  fi
fi

echo "DEPENDENCY_GATE_PASS: figma-developer-mcp ${DEP_DECLARED} (resolved ${RESOLVED_VERSION}) >= 0.6.3"
exit 0
