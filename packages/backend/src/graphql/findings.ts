const FINDING_FIELDS = `
  id
  title
  description
  host
  path
  reporter
  dedupeKey
  hidden
  createdAt
  request { id }
`;

export const LIST_FINDINGS_QUERY = `
  query findings($first: Int, $after: String, $last: Int, $before: String, $filter: FilterClauseFindingInput, $order: FindingOrderInput) {
    findings(first: $first, after: $after, last: $last, before: $before, filter: $filter, order: $order) {
      pageInfo {
        hasPreviousPage
        hasNextPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          ${FINDING_FIELDS}
        }
      }
      snapshot
      count { value }
    }
  }
`;

export const GET_FINDING_QUERY = `
  query finding($id: ID!) {
    finding(id: $id) {
      ${FINDING_FIELDS}
    }
  }
`;

export const UPDATE_FINDING_MUTATION = `
  mutation updateFinding($id: ID!, $input: UpdateFindingInput!) {
    updateFinding(id: $id, input: $input) {
      finding {
        ${FINDING_FIELDS}
      }
    }
  }
`;

export const DELETE_FINDINGS_MUTATION = `
  mutation deleteFindings($input: DeleteFindingsInput!) {
    deleteFindings(input: $input) {
      deletedIds
    }
  }
`;
