#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
OUT_FILE="${2:-gql.txt}"
CAIDO_TOKEN="${CAIDO_TOKEN:-}"
CAIDO_COOKIE="${CAIDO_COOKIE:-}"
CAIDO_TIMEOUT_SECONDS="${CAIDO_TIMEOUT_SECONDS:-30}"

AUTH_HEADER=()
if [[ -n "${CAIDO_TOKEN}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${CAIDO_TOKEN}")
fi

COOKIE_HEADER=()
if [[ -n "${CAIDO_COOKIE}" ]]; then
  COOKIE_HEADER=(-H "Cookie: ${CAIDO_COOKIE}")
fi

TEMP_FILE="$(mktemp "${OUT_FILE}.tmp.XXXXXX")"
trap 'rm -f "${TEMP_FILE}"' EXIT

cat <<'QUERY' | jq -Rs '{query: .}' | curl --fail --show-error --silent \
  --max-time "${CAIDO_TIMEOUT_SECONDS}" "${BASE_URL}/graphql" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  "${COOKIE_HEADER[@]}" \
  -d @- \
  > "${TEMP_FILE}"
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types { ...FullType }
    directives { name description isRepeatable locations args(includeDeprecated: true) { ...InputValue } }
  }
}
fragment FullType on __Type {
  kind name description
  fields(includeDeprecated: true) {
    name description args(includeDeprecated: true) { ...InputValue }
    type { ...TypeRef } isDeprecated deprecationReason
  }
  inputFields(includeDeprecated: true) { ...InputValue }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason }
  possibleTypes { ...TypeRef }
}
fragment InputValue on __InputValue {
  name description type { ...TypeRef } defaultValue isDeprecated deprecationReason
}
fragment TypeRef on __Type {
  kind name ofType {
    kind name ofType {
      kind name ofType {
        kind name ofType {
          kind name ofType {
            kind name ofType {
              kind name ofType { kind name }
            }
          }
        }
      }
    }
  }
}
QUERY

if jq -e '.errors and (.errors | length > 0)' "${TEMP_FILE}" >/dev/null 2>&1; then
  jq '.errors' "${TEMP_FILE}" >&2
  echo "GraphQL introspection failed. Check auth headers/token/cookie." >&2
  exit 1
fi
if ! jq -e '.data.__schema' "${TEMP_FILE}" >/dev/null 2>&1; then
  echo "GraphQL introspection returned no schema." >&2
  exit 1
fi

mv "${TEMP_FILE}" "${OUT_FILE}"
trap - EXIT
echo "Wrote schema to ${OUT_FILE}"
