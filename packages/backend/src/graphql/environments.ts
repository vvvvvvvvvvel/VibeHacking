export const LIST_ENVIRONMENTS_QUERY = `
  query environments {
    environments {
      id
      name
      version
      variables {
        name
        value
        kind
      }
    }
  }
`;

export const GET_ENVIRONMENT_QUERY = `
  query environment($id: ID!) {
    environment(id: $id) {
      id
      name
      version
      variables {
        name
        value
        kind
      }
    }
  }
`;

export const GET_ENVIRONMENT_CONTEXT_QUERY = `
  query environmentContext {
    environmentContext {
      selected {
        id
        name
        version
        variables {
          name
          value
          kind
        }
      }
      global {
        id
        name
        version
        variables {
          name
          value
          kind
        }
      }
    }
  }
`;

export const CREATE_ENVIRONMENT_MUTATION = `
  mutation createEnvironment($input: CreateEnvironmentInput!) {
    createEnvironment(input: $input) {
      environment {
        id
        name
        version
        variables {
          name
          value
          kind
        }
      }
    }
  }
`;

export const UPDATE_ENVIRONMENT_MUTATION = `
  mutation updateEnvironment($id: ID!, $input: UpdateEnvironmentInput!) {
    updateEnvironment(id: $id, input: $input) {
      environment {
        id
        name
        version
        variables {
          name
          value
          kind
        }
      }
    }
  }
`;

export const DELETE_ENVIRONMENT_MUTATION = `
  mutation deleteEnvironment($id: ID!) {
    deleteEnvironment(id: $id) {
      deletedId
    }
  }
`;

export const SELECT_ENVIRONMENT_MUTATION = `
  mutation selectEnvironment($id: ID) {
    selectEnvironment(id: $id) {
      environment {
        id
        name
        version
        variables {
          name
          value
          kind
        }
      }
    }
  }
`;
