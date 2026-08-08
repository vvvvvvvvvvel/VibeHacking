# Serialization, Projection, and Regex Excerpts

These controls shape the **size and form** of output. They are supported by `list_requests`,
`get_requests_by_ids`, `list_sitemap_entry_requests`, `list_findings` (HTTP pairs), and the
WebSocket message tools. Projection and serialization change output shape only — they do not
change which rows are selected (use HTTPQL / tool filters for that).

## Field projection: `fields` / `exclude_fields`

- `fields` is a whitelist of dotted paths; `exclude_fields` is a blacklist. They are mutually exclusive.
- Projection applies to item payloads only; envelope keys (`page_info`, `items`, `requested`,
  `found`, `results`) are always preserved.
- Headers and bodies are auto-materialized from the paths you request. `request.raw` /
  `response.raw` are returned only when explicitly requested.
- The default shape drops redundant/derived fields (for example `in_scope`, `request.path`,
  `request.query`, empty `cookies`). Request them back explicitly through `fields` when needed
  (e.g. `fields: ["in_scope"]`).

Common request paths: `id`, `time`, `cursor`, `in_scope`, `request.method`, `request.url`,
`request.headers`, `request.body.text`, `request.raw.text`, `response.status_code`,
`response.headers`, `response.body.text`, `response.raw.text`, `match_context.excerpts`.

## Serialization options

Body output uses `{ encoding, size, text | base64, omitted_reason }`.

- `include_body` (default `false` for broad `list_requests` discovery; `true` for `get_requests_by_ids`).
- `include_binary` (default `false`) and `max_binary_body_bytes` — binary bodies are omitted with a
  reason unless explicitly enabled and under the cap.
- `max_text_body_chars` / `max_response_body_chars` and `text_overflow_mode` (`truncate` | `omit`).
- WebSocket payloads: `max_text_payload_chars`.

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

## Regex excerpts

Use `serialization.regex_excerpt` plus `fields: ["match_context.excerpts"]` to return only
matching fragments instead of full bodies. If body/raw fields are also requested alongside an
excerpt, they are ignored and excerpts are returned instead. Excerpts are extracted from rows
already selected by the tool — narrow the row set with HTTPQL first.

Find likely API tokens without returning full responses:

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
    "fields": ["id", "request.method", "request.url", "response.status_code", "match_context.excerpts"]
}
```

Extract only CSRF/session-like fragments from exact requests:

```json
{
    "ids": [123, 124],
    "serialization": {
        "regex_excerpt": {
            "regex": "\"(?:csrf|csrf_token|session|session_id)\"\\s*:\\s*\"[^\"]+\"|(?:csrf|session_id)=[^&\\s\";]+",
            "context_chars": 24
        }
    },
    "fields": ["id", "request.url", "match_context.excerpts"]
}
```
