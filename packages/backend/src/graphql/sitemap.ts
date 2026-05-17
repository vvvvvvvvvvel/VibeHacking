const SITEMAP_RESPONSE_FIELDS = `
  id
  statusCode
  length
  roundtripTime
  alteration
  edited
  createdAt
`;

const SITEMAP_REQUEST_FIELDS = `
  id
  host
  method
  path
  query
  length
  port
  isTls
  sni
  fileExtension
  source
  alteration
  edited
  createdAt
  response {
    ${SITEMAP_RESPONSE_FIELDS}
  }
`;

const SITEMAP_ENTRY_FIELDS = `
  id
  label
  kind
  parentId
  metadata {
    ... on SitemapEntryMetadataDomain {
      port
      isTls
    }
  }
  hasDescendants
  request {
    ${SITEMAP_REQUEST_FIELDS}
  }
  requests(first: $requestFirst, order: $requestOrder) {
    pageInfo {
      hasPreviousPage
      hasNextPage
      startCursor
      endCursor
    }
    nodes {
      ${SITEMAP_REQUEST_FIELDS}
    }
    snapshot
    count { value }
  }
`;

export const LIST_SITEMAP_ROOTS_QUERY = `
  query sitemapRootEntries($scopeId: ID, $requestFirst: Int, $requestOrder: RequestResponseOrderInput) {
    sitemapRootEntries(scopeId: $scopeId) {
      pageInfo {
        hasPreviousPage
        hasNextPage
        startCursor
        endCursor
      }
      nodes {
        ${SITEMAP_ENTRY_FIELDS}
      }
      snapshot
      count { value }
    }
  }
`;

export const LIST_SITEMAP_DESCENDANTS_QUERY = `
  query sitemapDescendantEntries($parentId: ID!, $depth: SitemapDescendantsDepth!, $requestFirst: Int, $requestOrder: RequestResponseOrderInput) {
    sitemapDescendantEntries(parentId: $parentId, depth: $depth) {
      pageInfo {
        hasPreviousPage
        hasNextPage
        startCursor
        endCursor
      }
      nodes {
        ${SITEMAP_ENTRY_FIELDS}
      }
      snapshot
      count { value }
    }
  }
`;

export const GET_SITEMAP_ENTRY_QUERY = `
  query sitemapEntry($id: ID!, $requestFirst: Int, $requestOrder: RequestResponseOrderInput) {
    sitemapEntry(id: $id) {
      ${SITEMAP_ENTRY_FIELDS}
    }
  }
`;

export const LIST_SITEMAP_ENTRY_REQUESTS_QUERY = `
  query sitemapEntryRequests($id: ID!, $first: Int, $after: String, $last: Int, $before: String, $order: RequestResponseOrderInput) {
    sitemapEntry(id: $id) {
      id
      label
      kind
      parentId
      requests(first: $first, after: $after, last: $last, before: $before, order: $order) {
        pageInfo {
          hasPreviousPage
          hasNextPage
          startCursor
          endCursor
        }
        edges {
          cursor
          node {
            ${SITEMAP_REQUEST_FIELDS}
          }
        }
        snapshot
        count { value }
      }
    }
  }
`;
