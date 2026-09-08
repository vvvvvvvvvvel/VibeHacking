export const GET_PASSTHROUGH_OPTIONS_QUERY = `
  query passthroughOptions {
    passthroughOptions {
      passthroughOptions {
        allowlist
        denylist
        outOfScope
      }
    }
  }
`;

export const SET_PASSTHROUGH_OPTIONS_MUTATION = `
  mutation setPassthroughOptions($input: PassthroughOptionsInput!) {
    setPassthroughOptions(input: $input) {
      options {
        passthroughOptions {
          allowlist
          denylist
          outOfScope
        }
      }
    }
  }
`;
