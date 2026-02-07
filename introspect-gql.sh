#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
OUT_FILE="${2:-gql.txt}"
CAIDO_TOKEN="${CAIDO_TOKEN:-}"
CAIDO_COOKIE="${CAIDO_COOKIE:-}"

AUTH_HEADER=()
if [[ -n "${CAIDO_TOKEN}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${CAIDO_TOKEN}")
fi

COOKIE_HEADER=()
if [[ -n "${CAIDO_COOKIE}" ]]; then
  COOKIE_HEADER=(-H "Cookie: ${CAIDO_COOKIE}")
fi

cat <<'QUERY' | jq -Rs '{query: .}' | curl -s "${BASE_URL}/graphql" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  "${COOKIE_HEADER[@]}" \
  -d @- \
  > "${OUT_FILE}"
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types { ...FullType }
    directives { name description locations args { ...InputValue } }
  }
}
fragment FullType on __Type {
  kind name description
  fields(includeDeprecated: true) {
    name description args { ...InputValue }
    type { ...TypeRef } isDeprecated deprecationReason
  }
  inputFields { ...InputValue }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) { name description isDeprecated deprecationReason }
  possibleTypes { ...TypeRef }
}
fragment InputValue on __InputValue {
  name description type { ...TypeRef } defaultValue
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

echo "Wrote schema to ${OUT_FILE}"
if jq -e '.errors and (.errors | length > 0)' "${OUT_FILE}" >/dev/null 2>&1; then
  echo "GraphQL errors detected in ${OUT_FILE}. Check auth headers/token/cookie."
fi
