# HTTPQL Reference

HTTPQL is Caido's filter language. It is used as a raw string in `list_requests.filter`,
`summarize_request_auth_headers.filter`, `summarize_request_cookies.filter`,
`send_to_replay_from_filter.filter`, and filter presets.

## Syntax

- Namespaces: `req.*` for request fields, `resp.*` for response fields, `row.*` for table rows.
- Combine clauses with `AND` / `OR` and parentheses.
- `req` fields: `created_at`, `ext` (file extension, includes the dot), `host`, `len`, `body`, `method`, `path`, `port`, `header`, `header["name"]`, `query`, `raw`, `tls`.
- `resp` fields: `code`, `len`, `body`, `header`, `header["name"]`, `raw`, `roundtrip` (ms).
- `row` fields: `id`.
- Operators:
    - `eq` / `ne` — exact match.
    - `cont` / `ncont` — contains / does not contain (case-insensitive).
    - `like` / `nlike` — SQLite LIKE / NOT LIKE; `%` matches any sequence and `_` one character.
    - `gt` / `gte` / `lt` / `lte` — numbers and dates.
    - `regex` / `nregex` — regular expression on text (some regex features are unsupported).
- `created_at` formats: RFC3339, ISO 8601, RFC2822, RFC7231, ISO9075.

```text
req.host.eq:"example.com" AND (req.path.cont:"/api/" OR req.created_at.gt:"2025-02-02T01:02:03+00:00")
```

Docs: https://docs.caido.io/app/reference/httpql — Guide: https://docs.caido.io/app/guides/filters_httpql

## Filtering by host (scope-independent)

A Caido scope can be broad (for example `.+`, matching every host), so verify it before relying on
it for narrowing. HTTPQL host filters are explicit and independent of the configured scope.

- Exact host: `req.host.eq:"target.example.com"`
- Root domain + subdomains, without unrelated suffixes: `(req.host.eq:"example.com" OR req.host.like:"%.example.com")`
- Broad substring discovery (can also match `notexample.com`): `req.host.cont:"example.com"`
- Regex for genuine patterns: see the escaping note below.
- Exclude a noisy CDN/host: `req.host.cont:"example.com" AND req.host.ncont:"cdn"`

### Regex escaping gotcha (verified against Caido)

HTTPQL quoted strings do their **own** backslash unescaping before the regex engine sees them.
A single `\` is consumed, so `req.host.regex:"vk\.com"` matches **nothing**. Options:

- Simplest for non-security-sensitive discovery: leave dots unescaped. `req.host.regex:"example.com$"`
  matches `example.com` and `www.example.com`, but `.` is a wildcard and can also match a valid
  hostname character. Do not use this form as a strict scope boundary.
- If you truly need a literal dot, you must double it so one backslash survives HTTPQL
  unescaping — and because the filter is also a JSON string, that becomes **four** backslashes in
  JSON: `"filter": "req.host.regex:\"example\\\\.com$\""`. Prefer exact `eq` / `like` host
  expressions when a domain boundary matters.

```json
{
    "limit": 50,
    "order": { "target": "req", "field": "id", "direction": "desc" },
    "filter": "req.host.regex:\"example.com$\"",
    "fields": ["cursor", "id", "request.method", "request.url", "response.status_code"]
}
```

Then pull full request + response for the IDs you found via `get_requests_by_ids` with
`fields: ["id", "request.raw.text", "response.raw.text"]`.

## Token / secret hunting

Narrow rows with HTTPQL, then let `regex_excerpt` return only the matching fragments (see
`serialization.md`). Example filter that pre-selects likely auth/token traffic for one host:

```text
req.host.eq:"api.example.com" AND (req.raw.cont:"authorization" OR req.raw.cont:"x-api-key" OR req.raw.cont:"api_token" OR resp.raw.cont:"access_token" OR resp.raw.cont:"refresh_token")
```

## Common patterns

```text
req.method.eq:"POST"
req.path.cont:"/api/" AND (req.method.eq:"POST" OR req.method.eq:"PUT")
resp.code.eq:401 OR resp.code.eq:403
resp.code.gte:500
req.ext.eq:".js"
req.path.cont:"/graphql" AND req.method.eq:"POST"
req.created_at.gt:"2025-02-02T01:02:03+00:00"
```
