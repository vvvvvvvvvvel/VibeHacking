export const GET_PROXY_TRAFFIC_CONTROL_QUERY = `
  query passthroughOptions {
    passthroughOptions {
      captureList
      passthroughList
      outOfScope
    }
  }
`;

export const SET_PROXY_TRAFFIC_CONTROL_MUTATION = `
  mutation setPassthroughOptions($input: SetPassthroughOptionsInput) {
    setPassthroughOptions(input: $input) {
      options {
        captureList
        passthroughList
        outOfScope
      }
    }
  }
`;
