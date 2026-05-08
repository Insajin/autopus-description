# SPEC-FIGMA-008 Threat Model

## T1: Tunnel URL leak

### Mitigation

Tunnel URLs are treated as sensitive runtime data. Logs and MCP responses must pass through tunnel URL redaction before persistence or client display.

## T2: Bearer reuse across machines

### Mitigation

Bearer credentials are scoped to one tunnel session and expire by TTL. A copied token must not grant durable access after session revocation.

## T3: pluginData plaintext exposure

### Mitigation

pluginData writes should contain only approved description metadata. Secrets, raw prompts, bearer tokens, and local absolute paths must be stripped before write planning.

## T4: cloudflared dependency outage

### Mitigation

Tunnel transport is optional. Capability negotiation must degrade to local stdio/http or fallback polling when cloudflared cannot attach.

## T5: MCP method spoofing pre-handshake

### Mitigation

MCP requests are accepted only after transport initialization establishes a session profile. Unknown methods or pre-handshake write attempts fail closed.
