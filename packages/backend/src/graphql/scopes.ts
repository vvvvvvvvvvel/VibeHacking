export const LIST_SCOPES_QUERY = `
  query scopes {
    scopes {
      id
      name
      allowlist
      denylist
      indexed
    }
  }
`;

export const GET_SCOPE_QUERY = `
  query scope($id: ID!) {
    scope(id: $id) {
      id
      name
      allowlist
      denylist
      indexed
    }
  }
`;

export const CREATE_SCOPE_MUTATION = `
  mutation createScope($input: CreateScopeInput!) {
    createScope(input: $input) {
      scope {
        id
        name
        allowlist
        denylist
        indexed
      }
    }
  }
`;

export const UPDATE_SCOPE_MUTATION = `
  mutation updateScope($id: ID!, $input: UpdateScopeInput!) {
    updateScope(id: $id, input: $input) {
      scope {
        id
        name
        allowlist
        denylist
        indexed
      }
    }
  }
`;

export const RENAME_SCOPE_MUTATION = `
  mutation renameScope($id: ID!, $name: String!) {
    renameScope(id: $id, name: $name) {
      scope {
        id
        name
      }
    }
  }
`;

export const DELETE_SCOPE_MUTATION = `
  mutation deleteScope($id: ID!) {
    deleteScope(id: $id) {
      deletedId
    }
  }
`;
