# Vibe Hacking

A Caido MCP plugin that exposes a clean, safe, and well‑documented tool surface for agents. It standardizes tool schemas, descriptions, and behaviors across requests, replay, filters, scopes, tamper rules, and WebSocket history.

## Highlights

- **MCP‑native**: exposes an MCP server over Streamable HTTP inside Caido.
- **Tool governance**: group tools into safe/unsafe buckets and control them with `auto`, `confirm`, or `disabled` modes.
- **Clear UX**: user‑friendly tool names in the UI (no SDK internals).
- **History-first output**: request and WebSocket tools use stable list/get envelopes, Caido-native filters, field projection, and bounded body serialization.

![Overview](./assets/screenshot-overview.png)

## Install

1. Build the plugin in this repo.
2. Load it in Caido as a local plugin.

> If you already have a dev flow, just build and load as usual.

## Compatibility

- **Caido**: v0.55.1+

## Usage

- Open the plugin page in Caido.
- Use the **Tools** section to set each group to `auto`, `confirm`, or `disabled`.
- Call tools from your agent and rely on consistent JSON outputs.

## Tooling Notes

- Some tools accept arrays even when the name is singular — this is intentional to support batch operations while keeping UI labels simple.
- Broad history discovery should start with `list_requests` / `list_websocket_messages` and tight `fields`; exact follow-up should use `get_requests_by_ids` / `get_websocket_messages_by_ids`.
- `list_requests` uses native Caido cursor pagination; feed `page_info.end_cursor`/`start_cursor` back as `cursor`.
- `list_requests.filter` is a raw HTTPQL string for method, host, status, port, time, path, raw, and row constraints.
- HTTP body output uses `{ encoding, size, text|base64, omitted_reason }`. Raw request/response bytes are returned only when requested through `fields`.
- `list_requests.serialization.include_body=false` by default for broad discovery; set it to `true` or request body/raw paths explicitly through `fields`.
- `fields` and `exclude_fields` project item payloads while preserving envelopes such as `page_info`, `items`, `requested`, `found`, and `results`.

## Core Tool Catalog

Request history:

- `list_requests`
- `get_requests_by_ids`
- `match_requests`
- `send_requests`
- `check_requests_scope`
- `summarize_request_cookies`
- `summarize_request_auth_headers`

WebSocket/SSE:

- `list_websocket_streams`
- `get_websocket_streams_by_ids`
- `list_websocket_messages`
- `get_websocket_messages_by_ids`
- `get_websocket_message_edits_by_ids`

Environment:

- `list_environments`
- `get_environment`
- `get_environment_context`
- `create_environment`
- `update_environment`
- `delete_environment`
- `select_environment`
- `get_environment_variable`
- `list_environment_variables`
- `set_environment_variable`

Other existing groups cover Replay, Tamper rules, scopes, findings, hosted files, project/runtime info, and HTTPQL help.

Example request discovery:

```json
{
    "limit": 50,
    "filter": "req.host.eq:\"example.com\" AND req.method.eq:\"POST\" AND (resp.code.eq:200 OR resp.code.eq:401)",
    "fields": ["cursor", "id", "time", "request.method", "request.url", "response.status_code"]
}
```

## Development

```bash
pnpm install
pnpm build
```

Watch mode:

```bash
pnpm watch
```

## License

MIT
