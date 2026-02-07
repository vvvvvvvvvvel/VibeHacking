export const UPDATE_FINDING_MUTATION = `
  mutation updateFinding($id: ID!, $input: UpdateFindingInput!) {
    updateFinding(id: $id, input: $input) {
      finding {
        id
        title
        description
        reporter
        dedupeKey
        request { id }
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
