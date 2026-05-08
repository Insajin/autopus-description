# SPEC-FIGMA-008 Opsec Runbook

## Daily session start

Start the daemon, confirm the active transport profile, and verify that audit output is being written under the expected `.autopus` directory.

## Token rotation policy

Tunnel sessions use TTL-as-rotation. The maximum session lifetime is TTL <= 28800000 ms, equivalent to 8 hours, unless a shorter operator policy is configured.

## Revoke flow

Revoke the active tunnel session, stop the daemon if needed, and confirm subsequent requests fail with an authentication or session error.

## Tunnel adapter swap

When cloudflared is unavailable, switch to the next supported transport profile and record the degraded capability in the transport matrix.

## Audit log review checklist

- [ ] Confirm tunnel URLs are redacted or hashed.
- [ ] Confirm bearer tokens are absent from persisted logs.
- [ ] Confirm Figma tokens are absent from persisted logs.
- [ ] Confirm remote write attempts include a plugin approval trail.
- [ ] Confirm failed probes include redacted error text only.
