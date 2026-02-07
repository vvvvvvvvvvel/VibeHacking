export const DELETE_HOSTED_FILE_MUTATION = `
mutation deleteHostedFile($id: ID!) {
  deleteHostedFile(id: $id) {
    deletedId
  }
}
`;
