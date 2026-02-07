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
          activeEntry {
            id
          }
          entries {
            count {
              value
            }
            nodes {
              id
              error
              createdAt
              raw
              request {
                id
              }
            }
          }
        }
      }
    }
  }
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
        collection {
          id
          name
        }
      }
    }
  }
`;

export const GET_REPLAY_SESSION_QUERY = `
  query replaySession($id: ID!) {
    replaySession(id: $id) {
      id
      name
      collection {
        id
        name
      }
    }
  }
`;

export const GET_REPLAY_ENTRY_QUERY = `
  query replayEntry($id: ID!) {
    replayEntry(id: $id) {
      id
      error
      raw
      connection {
        host
        port
        isTLS
        SNI
      }
      session {
        id
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
  }
`;

export const MOVE_REPLAY_SESSION_MUTATION = `
  mutation moveReplaySession($id: ID!, $collectionId: ID!) {
    moveReplaySession(id: $id, collectionId: $collectionId) {
      session {
        id
        name
        collection {
          id
          name
        }
      }
    }
  }
`;

export const START_REPLAY_TASK_MUTATION = `
  mutation startReplayTask($sessionId: ID!, $input: StartReplayTaskInput!) {
    startReplayTask(sessionId: $sessionId, input: $input) {
      task {
        id
        createdAt
        replayEntry {
          id
          session { id }
        }
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
