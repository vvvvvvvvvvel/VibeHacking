const STREAM_FIELDS = `
  id
  host
  port
  path
  isTls
  direction
  source
  protocol
  createdAt
`;

const STREAM_WS_MESSAGE_EDIT_FIELDS = `
  id
  alteration
  direction
  format
  length
  createdAt
  raw
`;

const STREAM_WS_MESSAGE_FIELDS = `
  id
  stream { id }
  edits { id alteration }
  head {
    ${STREAM_WS_MESSAGE_EDIT_FIELDS}
  }
`;

export const LIST_STREAMS_QUERY = `
  query streams($first: Int, $after: String, $last: Int, $before: String, $protocol: StreamProtocol, $order: StreamOrderInput, $scopeId: ID) {
    streams(first: $first, after: $after, last: $last, before: $before, protocol: $protocol, order: $order, scopeId: $scopeId) {
      pageInfo {
        hasPreviousPage
        hasNextPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ${STREAM_FIELDS}
        }
      }
      nodes {
        ${STREAM_FIELDS}
      }
      snapshot
      count { value }
    }
  }
`;

export const LIST_STREAMS_BY_OFFSET_QUERY = `
  query streamsByOffset($offset: Int!, $limit: Int!, $protocol: StreamProtocol, $order: StreamOrderInput, $scopeId: ID) {
    streamsByOffset(offset: $offset, limit: $limit, protocol: $protocol, order: $order, scopeId: $scopeId) {
      pageInfo {
        hasPreviousPage
        hasNextPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ${STREAM_FIELDS}
        }
      }
      nodes {
        ${STREAM_FIELDS}
      }
      snapshot
      count { value }
    }
  }
`;

export const GET_STREAM_QUERY = `
  query stream($id: ID!) {
    stream(id: $id) {
      ${STREAM_FIELDS}
    }
  }
`;

export const LIST_STREAM_WS_MESSAGES_QUERY = `
  query streamWsMessages($streamId: ID!, $first: Int, $after: String, $last: Int, $before: String, $order: StreamWsMessageOrderInput) {
    streamWsMessages(streamId: $streamId, first: $first, after: $after, last: $last, before: $before, order: $order) {
      pageInfo {
        hasPreviousPage
        hasNextPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ${STREAM_WS_MESSAGE_FIELDS}
        }
      }
      nodes {
        ${STREAM_WS_MESSAGE_FIELDS}
      }
      snapshot
      count { value }
    }
  }
`;

export const LIST_STREAM_WS_MESSAGES_BY_OFFSET_QUERY = `
  query streamWsMessagesByOffset($streamId: ID!, $offset: Int!, $limit: Int!, $order: StreamWsMessageOrderInput) {
    streamWsMessagesByOffset(streamId: $streamId, offset: $offset, limit: $limit, order: $order) {
      pageInfo {
        hasPreviousPage
        hasNextPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ${STREAM_WS_MESSAGE_FIELDS}
        }
      }
      nodes {
        ${STREAM_WS_MESSAGE_FIELDS}
      }
      snapshot
      count { value }
    }
  }
`;

export const GET_STREAM_WS_MESSAGE_QUERY = `
  query streamWsMessage($id: ID!) {
    streamWsMessage(id: $id) {
      ${STREAM_WS_MESSAGE_FIELDS}
    }
  }
`;

export const GET_STREAM_WS_MESSAGE_EDIT_QUERY = `
  query streamWsMessageEdit($id: ID!) {
    streamWsMessageEdit(id: $id) {
      ${STREAM_WS_MESSAGE_EDIT_FIELDS}
    }
  }
`;
