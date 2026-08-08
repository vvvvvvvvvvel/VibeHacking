# HTTPQL Reference

HTTPQL is Caido's filter language. It is used as a raw string in `list_requests.filter`,
`summarize_request_auth_headers.filter`, `summarize_request_cookies.filter`,
`send_to_replay_from_filter.filter`, and filter presets.

## Syntax

- Namespaces: `req.*` for request fields, `resp.*` for response fields, `row.*` for table rows.
- Combine clauses with `AND` / `OR` and parentheses.
- `req` fields: `ext` (file extension, includes the dot), `host`, `method`, `path`, `port`, `raw`, `created_at`.
- `resp` fields: `code`, `raw`, `roundtrip` (ms), `ext`.
- `row` fields: `id`.
- Operators:
  - `eq` / `ne` — exact match.
  - `cont` / `ncont` — contains (case-insensitive; LIKE supports `%` and `_`).
  - `gt` / `gte` / `lt` / `lte` — numbers and dates.
  - `regex` / `nregex` — regular expression on text (some regex features are unsupported).
- `created_at` formats: RFC3339, ISO 8601, RFC2822, RFC7231, ISO9075.

```text
req.host.eq:"example.com" AND (req.path.cont:"/api/" OR req.created_at.gt:"2025-02-02T01:02:03+00:00")
```

Docs: https://docs.caido.io/reference/httpql — Guide: https://docs.caido.io/app/guides/filters_httpql

## Filtering by host (scope-independent)

Caido scopes are often broad (for example `.+`, matching every host), so filtering by scope
rarely narrows anything. Filter by host directly instead.

- Exact host: `req.host.eq:"target.example.com"`
- Domain + subdomains (case-insensitive substring — usually what you want): `req.host.cont:"example.com"`
- Regex, end-anchored, `.` left as a wildcard: `req.host.regex:"example.com$"`
- Exclude a noisy CDN/host: `req.host.cont:"example.com" AND req.host.ncont:"cdn"`

### Regex escaping gotcha (verified against Caido)

HTTPQL quoted strings do their **own** backslash unescaping before the regex engine sees them.
A single `\` is consumed, so `req.host.regex:"vk\.com"` matches **nothing**. Options:

- Simplest: don't escape dots — use `.` as a wildcard. `req.host.regex:"example.com$"` matches
  `example.com` and `www.example.com`. False positives (a literal `X` where the `.` is) do not
  occur for real hostnames.
- If you truly need a literal dot, you must double it so one backslash survives HTTPQL
  unescaping — and because the filter is also a JSON string, that becomes **four** backslashes in
  JSON: `"filter": "req.host.regex:\"example\\\\.com$\""`. Prefer `req.host.cont` instead.

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
