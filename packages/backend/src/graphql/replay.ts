const REPLAY_PIPELINE_STRATEGY_FIELDS = `
  fragment ReplayPipelineStrategyFields on PipelineStrategy {
    __typename
    ... on PipelineStrategySequential {
      abortOnFailure
    }
    ... on PipelineStrategyLastByteSynchronization {
      failureBehavior
    }
    ... on PipelineStrategySinglePacketAttack {
      failureBehavior
      convertToHttp2
    }
  }
`;

const REPLAY_HTTP_ENTRY_FIELDS = `
  fragment ReplayHttpEntryFields on ReplayEntryHttp {
    id
    error
    createdAt
    raw
    connection {
      host
      port
      isTLS
      SNI
    }
    request {
      id
      host
      port
      path
      query
      method
      createdAt
      response {
        id
        statusCode
      }
    }
  }
`;

const REPLAY_ENTRY_FIELDS = `
  fragment ReplayEntryFields on ReplayEntry {
    id
    __typename
    error
    createdAt
    session {
      id
      name
      __typename
    }
    ... on ReplayEntryHttp {
      ...ReplayHttpEntryFields
    }
    ... on ReplayEntryWs {
      http {
        ...ReplayHttpEntryFields
      }
      stream {
        id
      }
    }
    ... on ReplayEntryHttpOnePipeline {
      settings {
        strategy {
          ...ReplayPipelineStrategyFields
        }
      }
      draft {
        settings {
          strategy {
            ...ReplayPipelineStrategyFields
          }
        }
      }
      activeHttpEntry {
        ...ReplayHttpEntryFields
      }
      httpEntries {
        ...ReplayHttpEntryFields
      }
    }
  }
`;

export const RENAME_REPLAY_COLLECTION_MUTATION = `
  mutation renameReplaySessionCollection($id: ID!, $name: String!) {
    renameReplaySessionCollection(id: $id, name: $name) {
      collection {
        id
        name
      }
    }
  }
`;

export const RENAME_REPLAY_SESSION_MUTATION = `
  mutation renameReplaySession($id: ID!, $name: String!) {
    renameReplaySession(id: $id, name: $name) {
      session {
        id
        name
      }
    }
  }
`;

export const CREATE_REPLAY_COLLECTION_MUTATION = `
  mutation createReplaySessionCollection($input: CreateReplaySessionCollectionInput!) {
    createReplaySessionCollection(input: $input) {
      collection {
        id
        name
      }
    }
  }
`;

export const LIST_REPLAY_COLLECTIONS_QUERY = `
  query replaySessionCollections($first: Int, $after: String, $last: Int, $before: String) {
    replaySessionCollections(first: $first, after: $after, last: $last, before: $before) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      nodes {
        id
        name
      }
    }
  }
`;

export const LIST_REPLAY_COLLECTIONS_DETAILED_QUERY = `
  query replaySessionCollections($first: Int, $after: String, $last: Int, $before: String) {
    replaySessionCollections(first: $first, after: $after, last: $last, before: $before) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      nodes {
        id
        name
        sessions {
          id
          name
          __typename
          ... on ReplaySessionHttpOnePipeline {
            settings {
              strategy {
                ...ReplayPipelineStrategyFields
              }
            }
          }
          ... on ReplaySessionHttp {
            collection {
              id
              name
            }
            activeEntry {
              id
              __typename
            }
            entries {
              count {
                value
              }
              nodes {
                ...ReplayEntryFields
              }
            }
          }
          ... on ReplaySessionHttpOnePipeline {
            collection {
              id
              name
            }
            activeEntry {
              id
              __typename
            }
            entries {
              count {
                value
              }
              nodes {
                ...ReplayEntryFields
              }
            }
          }
          ... on ReplaySessionWs {
            collection {
              id
              name
            }
            activeEntry {
              id
              __typename
            }
            entries {
              count {
                value
              }
              nodes {
                ...ReplayEntryFields
              }
            }
          }
        }
      }
    }
  }
  ${REPLAY_PIPELINE_STRATEGY_FIELDS}
  ${REPLAY_HTTP_ENTRY_FIELDS}
  ${REPLAY_ENTRY_FIELDS}
`;

export const LIST_REPLAY_SESSIONS_QUERY = `
  query replaySessions($first: Int, $after: String, $last: Int, $before: String) {
    replaySessions(first: $first, after: $after, last: $last, before: $before) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      nodes {
        id
        name
        __typename
        ... on ReplaySessionHttp {
          collection {
            id
            name
          }
        }
        ... on ReplaySessionHttpOnePipeline {
          collection {
            id
            name
          }
          settings {
            strategy {
              ...ReplayPipelineStrategyFields
            }
          }
          activeEntry {
            id
            __typename
          }
        }
        ... on ReplaySessionWs {
          collection {
            id
            name
          }
          activeEntry {
            id
            __typename
          }
        }
      }
    }
  }
  ${REPLAY_PIPELINE_STRATEGY_FIELDS}
`;

export const GET_REPLAY_SESSION_QUERY = `
  query replaySession($id: ID!) {
    replaySession(id: $id) {
      id
      name
      __typename
      ... on ReplaySessionHttp {
        collection {
          id
          name
        }
      }
      ... on ReplaySessionHttpOnePipeline {
        collection {
          id
          name
        }
        settings {
          strategy {
            ...ReplayPipelineStrategyFields
          }
        }
        activeEntry {
          id
          __typename
        }
      }
      ... on ReplaySessionWs {
        collection {
          id
          name
        }
        activeEntry {
          id
          __typename
        }
      }
    }
  }
  ${REPLAY_PIPELINE_STRATEGY_FIELDS}
`;

export const GET_REPLAY_ENTRY_QUERY = `
  query replayEntry($id: ID!, $sessionKind: ReplaySessionKind!) {
    replayEntry(id: $id, sessionKind: $sessionKind) {
      ...ReplayEntryFields
    }
  }
  ${REPLAY_PIPELINE_STRATEGY_FIELDS}
  ${REPLAY_HTTP_ENTRY_FIELDS}
  ${REPLAY_ENTRY_FIELDS}
`;

export const MOVE_REPLAY_SESSION_MUTATION = `
  mutation moveReplaySession($id: ID!, $collectionId: ID!) {
    moveReplaySession(id: $id, collectionId: $collectionId) {
      session {
        id
        name
        __typename
        ... on ReplaySessionHttp {
          collection {
            id
            name
          }
        }
        ... on ReplaySessionHttpOnePipeline {
          collection {
            id
            name
          }
        }
        ... on ReplaySessionWs {
          collection {
            id
            name
          }
        }
      }
    }
  }
`;

export const CREATE_REPLAY_PIPELINE_HTTP_ONE_SESSION_MUTATION = `
  mutation createReplayPipelineHttpOneSession($input: CreateReplayPipelineSessionInput!, $entryFirst: Int) {
    createReplayPipelineHttpOneSession(input: $input) {
      session {
        id
        name
        __typename
        collection {
          id
          name
        }
        settings {
          strategy {
            ...ReplayPipelineStrategyFields
          }
        }
        activeEntry {
          id
          __typename
        }
        entries(first: $entryFirst) {
          pageInfo {
            hasNextPage
            hasPreviousPage
            startCursor
            endCursor
          }
          count {
            value
          }
          nodes {
            ...ReplayEntryFields
          }
        }
      }
      error {
        __typename
        ... on UserError {
          code
        }
        ... on PermissionDeniedUserError {
          reason
        }
        ... on CloudUserError {
          reason
        }
      }
    }
  }
  ${REPLAY_PIPELINE_STRATEGY_FIELDS}
  ${REPLAY_HTTP_ENTRY_FIELDS}
  ${REPLAY_ENTRY_FIELDS}
`;

export const SET_ACTIVE_REPLAY_PIPELINE_ENTRY_HTTP_ENTRY_MUTATION = `
  mutation setActiveReplayPipelineEntryHttpEntry($id: ID!, $httpEntryId: ID!) {
    setActiveReplayPipelineEntryHttpEntry(id: $id, httpEntryId: $httpEntryId) {
      entry {
        ...ReplayEntryFields
      }
    }
  }
  ${REPLAY_PIPELINE_STRATEGY_FIELDS}
  ${REPLAY_HTTP_ENTRY_FIELDS}
  ${REPLAY_ENTRY_FIELDS}
`;

export const START_REPLAY_TASK_MUTATION = `
  mutation startReplayTask($sessionId: ID!) {
    startReplayTask(sessionId: $sessionId) {
      task {
        id
        createdAt
        sessionKind
        replayEntry {
          id
          session { id }
        }
      }
      error {
        __typename
      }
    }
  }
`;

export const DELETE_REPLAY_COLLECTION_MUTATION = `
  mutation deleteReplaySessionCollection($id: ID!) {
    deleteReplaySessionCollection(id: $id) {
      deletedId
    }
  }
`;

export const DELETE_REPLAY_SESSIONS_MUTATION = `
  mutation deleteReplaySessions($ids: [ID!]!) {
    deleteReplaySessions(ids: $ids) {
      deletedIds
    }
  }
`;
