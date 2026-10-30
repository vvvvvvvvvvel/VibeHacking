---
name: caido-mcp-core
description: "Use when investigating or testing web applications through Caido MCP: search captured HTTP traffic with HTTPQL, explore Sitemap, retrieve exact request and response evidence, send or replay requests, and inspect WebSocket traffic."
metadata:
    author: vvvvvvvvvvel
    compatibility: Requires a running Caido instance with the Vibe Hacking MCP plugin installed and reachable by the agent.
---

# Caido MCP Core

Use Caido as a traffic-first security workspace: discover candidates, narrow them, retrieve exact evidence, then send only the minimum requests needed for validation.

## Workflow

1. Discover with `list_requests` or the Sitemap tools using small field projections.
2. Narrow HTTP history with HTTPQL before retrieving bodies.
3. Fetch exact requests by ID with `get_requests_by_ids`.
4. Use `serialization.regex_excerpt` when only a token, identifier, nonce, header, or error fragment is needed.
5. Use `send_requests` to resend an existing history request by ID. Use `send_raw_requests` for a new or modified request.
6. Use Replay when a request must be prepared or inspected before execution.
7. Use WebSocket tools only for captured WS/WSS traffic.

Stay within this core workflow unless the user explicitly requests another Caido subsystem. Discovery is read-only; sending requests and starting Replay tasks produces network traffic.

## HTTP History

`list_requests.filter` is a raw HTTPQL string. Results are not limited to Caido scope by default, so narrow by host or path explicitly.

```json
{
    "limit": 50,
    "order": { "target": "req", "field": "id", "direction": "desc" },
    "filter": "req.host.eq:\"api.example.com\" AND req.path.cont:\"/api/\"",
    "fields": ["cursor", "id", "time", "request.method", "request.url", "response.status_code"]
}
```

Continue forward with `cursor: "<page_info.end_cursor>"`. Use `direction: "before"` with `page_info.start_cursor` only when paging backward.

Useful HTTPQL clauses:

```text
req.host.eq:"api.example.com"
(req.host.eq:"example.com" OR req.host.like:"%.example.com")
req.method.eq:"POST" AND req.path.cont:"/graphql"
resp.code.eq:401 OR resp.code.eq:403
resp.code.gte:500
req.raw.cont:"authorization" OR resp.raw.cont:"access_token"
```

Prefer `eq` for one exact host. For a root domain plus its subdomains, combine `eq` with `like:"%.example.com"`; use `cont` only for broad discovery because it also matches unrelated host suffixes. Read [references/httpql.md](references/httpql.md) only when advanced operators or escaping rules are needed.

### Extract only matching evidence

Narrow rows with HTTPQL, then return token-like fragments without returning complete bodies:

```json
{
    "limit": 50,
    "filter": "req.host.eq:\"api.example.com\" AND (req.raw.cont:\"authorization\" OR resp.raw.cont:\"access_token\")",
    "serialization": {
        "regex_excerpt": {
            "regex": "(?:Authorization|authorization):\\s*Bearer\\s+[A-Za-z0-9._~+\\-/=]+|\"(?:access_token|refresh_token|api_token)\"\\s*:\\s*\"[^\"]+\"",
            "context_chars": 32
        }
    },
    "fields": [
        "id",
        "request.method",
        "request.url",
        "response.status_code",
        "match_context.excerpts"
    ]
}
```

For exact full evidence, use IDs from discovery:

```json
{
    "ids": [123],
    "fields": ["id", "request.raw.text", "response.raw.text"],
    "serialization": {
        "include_body": true,
        "include_binary": false,
        "max_text_body_chars": 20000,
        "text_overflow_mode": "truncate"
    }
}
```

Read [references/serialization.md](references/serialization.md) only when custom projection, truncation, binary bodies, or regex excerpts require more detail.

## Sitemap

Use Sitemap for Caido's deduplicated host/path tree; use history for chronological traffic.

```json
{
    "limit": 50,
    "fields": ["id", "label", "kind", "metadata", "requests.count"]
}
```

```json
{
    "parent_id": 1,
    "depth": "ALL",
    "limit": 100,
    "filter": { "kinds": ["REQUEST"], "label_regex": "login|auth|api" },
    "fields": ["id", "label", "kind", "parent_id", "requests.count"]
}
```

Tree lists use `offset` and `next_offset`. To page actual traffic associated with one entry, use `list_sitemap_entry_requests`; it uses cursors and supports the same field projection, serialization, and regex excerpts as HTTP history.

## Active Requests

Send a saved request by ID:

```json
{
    "ids": [123],
    "options": { "timeouts": { "global": 15000 } },
    "serialization": { "include_body": true, "max_response_body_chars": 4000 }
}
```

Send a crafted UTF-8 request. Use `raw_base64` instead of `raw_text` only when binary bytes must be preserved:

```json
{
    "items": [
        {
            "raw_text": "GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n",
            "host": "example.com",
            "port": 443,
            "is_tls": true
        }
    ]
}
```

Both tools return the live response without requiring another history entry. Set `options.save=true` only when the sent request must remain in Caido for later evidence, comparison, or follow-up.

## Replay

Prepare Replay sessions from saved IDs, crafted raw requests, or both. This does not send traffic:

```json
{
    "request_ids": [123],
    "raw_requests": [
        {
            "raw_text": "GET /candidate HTTP/1.1\r\nHost: example.com\r\n\r\n",
            "host": "example.com",
            "port": 443,
            "is_tls": true
        }
    ]
}
```

Use `create_replay_pipeline_session` only for ordered, last-byte synchronization, or single-packet race testing. `start_replay_task` sends the current request for each selected session; call it only when active execution is intended.

## WebSocket

List streams first, then page messages for a selected stream:

```json
{
    "limit": 50,
    "filter": "stream.protocol.eq:\"WS\"",
    "order": { "by": "ID", "ordering": "DESC" }
}
```

```json
{
    "stream_id": 12,
    "limit": 100,
    "fields": ["cursor", "id", "time", "direction", "payload.text"],
    "serialization": { "max_text_payload_chars": 2000 }
}
```

Use exact-ID WebSocket getters only after stream/message discovery.

## Operational Checks

- Use `check_requests_scope` only when scope membership itself matters; HTTPQL host filtering is usually more useful for discovery.
- Keep broad discovery body-light. Retrieve raw requests, responses, and WS payloads only for selected candidates.
- Record request IDs, filters, active sends, and any remaining uncertainty in the result.
