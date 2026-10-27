const AUTOMATE_CONNECTION_FIELDS = `
  fragment AutomateConnectionFields on ConnectionInfo {
    host
    port
    isTLS
    SNI
  }
`;

const AUTOMATE_SETTINGS_FIELDS = `
  fragment AutomateSettingsFields on AutomateSettings {
    strategy
    closeConnection
    updateContentLength
    placeholders {
      start
      end
    }
    redirect {
      strategy
      max
    }
    concurrency {
      workers
      delay
    }
    retryOnFailure {
      maximumRetries
      backoff
    }
    payloads {
      options {
        __typename
        ... on AutomateSimpleListPayload {
          list @include(if: $includePayloadValues)
        }
        ... on AutomateHostedFilePayload {
          id
          delimiter
        }
        ... on AutomateNullPayload {
          quantity
        }
        ... on AutomateNumberPayload {
          range {
            start
            end
          }
          increments
          minLength
        }
      }
      preprocessors {
        options {
          __typename
          ... on AutomatePrefixPreprocessor {
            value
          }
          ... on AutomateSuffixPreprocessor {
            value
          }
          ... on AutomateUrlEncodePreprocessor {
            nonAscii
            charset
          }
          ... on AutomateWorkflowPreprocessor {
            id
          }
        }
      }
    }
    extractors {
      __typename
      ... on AutomateExtractorRegex {
        regex
        body
        workflowId
      }
    }
  }
`;

export const LIST_AUTOMATE_SESSIONS_QUERY = `
  query automateSessions($first: Int, $after: String, $last: Int, $before: String) {
    automateSessions(first: $first, after: $after, last: $last, before: $before) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      count {
        value
      }
      snapshot
      nodes {
        id
        name
        createdAt
        connection {
          ...AutomateConnectionFields
        }
      }
    }
  }
  ${AUTOMATE_CONNECTION_FIELDS}
`;

export const GET_AUTOMATE_SESSION_QUERY = `
  query automateSession($id: ID!, $includeRaw: Boolean!, $includePayloadValues: Boolean!) {
    automateSession(id: $id) {
      id
      name
      createdAt
      raw @include(if: $includeRaw)
      connection {
        ...AutomateConnectionFields
      }
      settings {
        ...AutomateSettingsFields
      }
      entries {
        id
        name
        createdAt
        connection {
          ...AutomateConnectionFields
        }
      }
    }
  }
  ${AUTOMATE_CONNECTION_FIELDS}
  ${AUTOMATE_SETTINGS_FIELDS}
`;

export const GET_AUTOMATE_ENTRY_QUERY = `
  query automateEntry($id: ID!, $includeRaw: Boolean!, $includePayloadValues: Boolean!) {
    automateEntry(id: $id) {
      id
      name
      createdAt
      raw @include(if: $includeRaw)
      connection {
        ...AutomateConnectionFields
      }
      settings {
        ...AutomateSettingsFields
      }
      session {
        id
        name
      }
      requests(first: 1) {
        count {
          value
        }
        snapshot
      }
    }
  }
  ${AUTOMATE_CONNECTION_FIELDS}
  ${AUTOMATE_SETTINGS_FIELDS}
`;

export const LIST_AUTOMATE_ENTRY_REQUESTS_QUERY = `
  query automateEntryRequests(
    $id: ID!
    $first: Int
    $after: String
    $last: Int
    $before: String
    $filter: HTTPQLInput
    $order: AutomateEntryRequestOrderInput
    $includeValues: Boolean!
  ) {
    automateEntry(id: $id) {
      id
      name
      requests(
        first: $first
        after: $after
        last: $last
        before: $before
        filter: $filter
        order: $order
      ) {
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
        count {
          value
        }
        snapshot
        edges {
          cursor
          node {
            sequenceId
            automateEntryId
            error
            payloads {
              raw @include(if: $includeValues)
              position
            }
            extracts {
              name
              raw @include(if: $includeValues)
            }
            request {
              id
            }
          }
        }
      }
    }
  }
`;
