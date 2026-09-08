---
name: caido-mcp
description: Use the Caido MCP tools to inspect and act on captured HTTP/WebSocket traffic in Caido — HTTP history, Sitemap, WebSocket, Replay, scopes, proxy passthrough, findings, filters, environments, and Tamper (Match & Replace) rules. Covers HTTPQL filtering (including host filtering when scope is broad), compact field projections, regex excerpts, and safe evidence-focused workflows. Use whenever the task involves reading Caido traffic or driving Caido through MCP.
compatibility: Requires a running Caido instance with the Vibe Hacking MCP plugin installed and reachable by the agent.
metadata:
    author: vvvvvvvvvvel
---

# Caido MCP

Drive Caido through MCP: discover traffic read-only, narrow with Caido-native filters, pull exact evidence by ID, and send traffic only for active validation.

## Operating Workflow

1. Start read-only: HTTP history (`list_requests`) or Sitemap discovery with a small `fields` list.
2. Narrow with Caido-native filters: HTTPQL for history, the `filter` object for Sitemap.
3. Pull exact evidence by ID only after discovery (`get_requests_by_ids`, `list_sitemap_entry_requests`).
4. Use `regex_excerpt` when only a token, ID, nonce, header, or error fragment is needed.
5. Send traffic only when the user expects active validation. Prefer `options.save=true` for later evidence.
6. Report IDs, filters, active sends, and remaining uncertainty.

Keep broad discovery body-light. Do not request raw bodies unless they are necessary evidence.

Use `get_proxy_passthrough_options` before changing proxy passthrough behavior. Use `set_proxy_passthrough_options` only when the user wants Caido to bypass/allow/deny specific targets.

## Scope

Discovery tools return **all** captured traffic by default — they are **not** limited to Caido scope. Scope is opt-in:

- `list_requests` never applies a scope filter; it only annotates `in_scope` per row (hidden from the default shape — request it with `fields: ["in_scope"]`).
- `list_sitemap_roots` / `list_sitemap_descendants` / `list_websocket_streams` accept an optional `scope_id`; omit it to see everything.

Caido scopes are often broad (for example `.+`, matching every host), so scope is usually useless for narrowing. **Filter by host with HTTPQL instead** (see below). Use `list_scopes` / `check_requests_scope` only when the user explicitly cares about scope membership.

## HTTP History

Use `list_requests` for chronological traffic discovery. Its `filter` is a raw HTTPQL string (not a structured object).

Recent API traffic:

```json
{
    "limit": 50,
    "order": { "target": "req", "field": "id", "direction": "desc" },
    "filter": "req.path.cont:\"/api/\"",
    "fields": ["cursor", "id", "time", "request.method", "request.url", "response.status_code"]
}
```

Continue with `cursor: "<page_info.end_cursor>"`. For backward pagination use `direction: "before"` and `cursor: "<page_info.start_cursor>"`.

### Requests and responses from one host

This is the primary way to scope your view when the Caido scope is broad (e.g. `.+`). Filter by host, then pull full request+response by ID.

Exact host match:

```json
{
    "limit": 50,
    "order": { "target": "req", "field": "id", "direction": "desc" },
    "filter": "req.host.eq:\"target.example.com\"",
    "fields": ["cursor", "id", "request.method", "request.url", "response.status_code"]
}
```

Domain + all subdomains (simplest, case-insensitive substring) — usually what you want:

```json
{
    "limit": 50,
    "filter": "req.host.cont:\"example.com\"",
    "fields": ["cursor", "id", "request.method", "request.url", "response.status_code"]
}
```

Host by regex — anchor at the end and leave `.` as a wildcard. Do **not** backslash-escape dots: Caido's HTTPQL string parser consumes a single `\`, so `\.` silently matches nothing. `.` matches the literal dot well enough for hostnames.

```json
{
    "limit": 50,
    "filter": "req.host.regex:\"example.com$\"",
    "fields": ["cursor", "id", "request.method", "request.url", "response.status_code"]
}
```

Then pull full request and response bytes for the IDs you found:

```json
{
    "ids": [123, 124],
    "fields": ["id", "request.raw.text", "response.raw.text"],
    "serialization": {
        "include_body": true,
        "include_binary": false,
        "max_text_body_chars": 20000,
        "text_overflow_mode": "truncate"
    }
}
```

Prefer `req.host.eq` for an exact host and `req.host.cont` for a domain plus its subdomains; reach for `req.host.regex` only for genuine patterns. See `references/httpql.md` for the escaping details.

### HTTPQL quick examples

```text
req.method.eq:"POST"
req.host.eq:"api.example.com" AND req.path.cont:"/api/"
resp.code.eq:401 OR resp.code.eq:403
req.raw.cont:"Authorization:" OR req.raw.cont:"X-API-Key:"
resp.raw.cont:"access_token" OR resp.raw.cont:"refresh_token"
req.path.cont:"/graphql" AND req.method.eq:"POST"
```

Prefer narrow host/path/method filters first, then add raw/header/body terms only when the candidate set is still too broad. Full HTTPQL syntax and operators: see `references/httpql.md`.

## Active Sends

Use `send_requests` only for active validation. It sends saved requests by ID:

```json
{
    "ids": [123],
    "options": { "save": true, "timeouts": { "global": 15000 } },
    "serialization": {
        "include_body": true,
        "include_binary": false,
        "max_response_body_chars": 4000,
        "text_overflow_mode": "truncate"
    }
}
```

To send a hand-crafted or modified request that is not saved, use `send_raw_requests` with base64 raw HTTP plus host/port/is_tls:

```json
{
    "items": [{ "raw_base64": "<base64>", "host": "example.com", "port": 443, "is_tls": true }],
    "options": { "save": true }
}
```

Both return the live response. A send appears in Caido history only when `options.save=true`.

For IDOR/auth checks, first gather two exact request IDs, compare with `get_requests_by_ids`, then send only the minimum request needed.

## Auth and Session Triage

Use summaries before pulling full headers. Run this shape with `summarize_request_auth_headers` or `summarize_request_cookies`:

```json
{
    "limit": 100,
    "filter": "req.host.eq:\"api.example.com\""
}
```

If the summary identifies useful IDs, pull exact minimal fields:

```json
{
    "ids": [123],
    "fields": ["id", "request.method", "request.url", "request.headers", "response.status_code"]
}
```

## Sitemap

Use Sitemap when the user needs Caido's deduplicated host/path tree instead of chronological history.

Root discovery:

```json
{
    "limit": 50,
    "fields": ["id", "label", "kind", "metadata", "requests.count"]
}
```

Subtree search (entry lists use offset pagination; continue while `has_more=true` using `next_offset`):

```json
{
    "parent_id": 1,
    "depth": "ALL",
    "limit": 100,
    "filter": { "kinds": ["REQUEST"], "label_regex": "login|auth|api" },
    "fields": ["id", "label", "kind", "parent_id", "requests.count"]
}
```

For real request pagination under one entry, use `list_sitemap_entry_requests` (cursor-paginated, supports the same serialization/`regex_excerpt`/`fields` controls as history):

```json
{
    "entry_id": 1,
    "limit": 50,
    "fields": ["cursor", "id", "request.method", "request.url", "response.status_code"]
}
```

## WebSocket

List streams first, then messages by stream:

```json
{
    "limit": 50,
    "protocol": "WS",
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

## Replay and Other Tools

- Replay: find source requests in history, then use `send_to_replay` or `send_to_replay_from_filter` to build sessions. Use `create_replay_pipeline_session` when preparing Caido's HTTP/1 pipeline Replay flow for ordered/last-byte/single-packet validation. Use `start_replay_task` (by `session_ids`) only when active Replay execution of those sessions is intended; it sends each session's current request. For a modified/crafted raw request, prefer `send_raw_requests`.
- Proxy passthrough: use `get_proxy_passthrough_options` to inspect allowlist, denylist, and out-of-scope passthrough. Use `set_proxy_passthrough_options` to update only the intended fields; omitted fields keep their current values.
- Scopes: see the Scope section. Use `list_scopes` / `get_scope` / `check_requests_scope` only when scope membership matters.
- Filters: use `list_filter_presets` and `get_filter_preset` to reuse saved HTTPQL.
- Findings: check existing findings before creating or updating.
- Tamper: list and test rules before enabling, moving, ranking, or editing them.
- Environment: use `get_environment_context` to inspect selected/global variables.

## Practical Rules

- `list_requests.filter` is HTTPQL, not a structured object.
- Discovery is not scope-limited by default; narrow by host/path with HTTPQL.
- `list_requests` omits bodies by default; `get_requests_by_ids` includes bodies by default, but `fields` shapes output.
- Sitemap tree lists use `offset` / `next_offset`; `list_sitemap_entry_requests` uses cursor pagination.
- Nested Sitemap `requests` are samples only; use `list_sitemap_entry_requests` for full paging.
- `regex_excerpt` returns snippets, not whole bodies; when body and raw produce the same body snippet, the raw duplicate is omitted.

## References

- `references/httpql.md` — full HTTPQL syntax, operators, host filtering, and token-hunting filters.
- `references/serialization.md` — serialization options, `fields`/`exclude_fields` projection, and `regex_excerpt`.
