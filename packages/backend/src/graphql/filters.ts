const FILTER_PRESET_FIELDS = `
      id
      name
      alias
      clause {
        __typename
        ... on HTTPQL {
          code
        }
        ... on StreamQL {
          code
        }
      }
`;

export const LIST_FILTER_PRESETS_QUERY = `
  query filterPresets {
    filterPresets {
${FILTER_PRESET_FIELDS}
    }
  }
`;

export const GET_FILTER_PRESET_QUERY = `
  query filterPreset($id: ID!) {
    filterPreset(id: $id) {
${FILTER_PRESET_FIELDS}
    }
  }
`;

export const CREATE_FILTER_PRESET_MUTATION = `
  mutation createFilterPreset($input: CreateFilterPresetInput!) {
    createFilterPreset(input: $input) {
      filter {
${FILTER_PRESET_FIELDS}
      }
      error {
        __typename
        ... on NameTakenUserError {
          name
          code
        }
        ... on AliasTakenUserError {
          alias
          code
        }
        ... on PermissionDeniedUserError {
          reason
          code
        }
        ... on CloudUserError {
          reason
          code
        }
        ... on OtherUserError {
          code
        }
      }
    }
  }
`;

export const UPDATE_FILTER_PRESET_MUTATION = `
  mutation updateFilterPreset($id: ID!, $input: UpdateFilterPresetInput!) {
    updateFilterPreset(id: $id, input: $input) {
      filter {
${FILTER_PRESET_FIELDS}
      }
      error {
        __typename
        ... on NameTakenUserError {
          name
          code
        }
        ... on AliasTakenUserError {
          alias
          code
        }
        ... on OtherUserError {
          code
        }
      }
    }
  }
`;

export const DELETE_FILTER_PRESET_MUTATION = `
  mutation deleteFilterPreset($id: ID!) {
    deleteFilterPreset(id: $id) {
      deletedId
    }
  }
`;
