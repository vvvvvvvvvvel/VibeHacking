const TAMPER_REPLACER_FIELDS = `
  __typename
  ... on TamperReplacerTerm { term }
  ... on TamperReplacerWorkflow { id }
`;

const TAMPER_MATCHER_NAME_FIELDS = `
  __typename
  name
`;

const TAMPER_MATCHER_RAW_FIELDS = `
  __typename
  ... on TamperMatcherValue { value }
  ... on TamperMatcherRegex { regex }
  ... on TamperMatcherFull { full }
`;

const TAMPER_OPERATION_HEADER_FIELDS = `
  __typename
  ... on TamperOperationHeaderAdd {
    matcher { ${TAMPER_MATCHER_NAME_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
  ... on TamperOperationHeaderUpdate {
    matcher { ${TAMPER_MATCHER_NAME_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
  ... on TamperOperationHeaderRemove {
    matcher { ${TAMPER_MATCHER_NAME_FIELDS} }
  }
  ... on TamperOperationHeaderRaw {
    matcher { ${TAMPER_MATCHER_RAW_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_OPERATION_QUERY_FIELDS = `
  __typename
  ... on TamperOperationQueryAdd {
    matcher { ${TAMPER_MATCHER_NAME_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
  ... on TamperOperationQueryUpdate {
    matcher { ${TAMPER_MATCHER_NAME_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
  ... on TamperOperationQueryRemove {
    matcher { ${TAMPER_MATCHER_NAME_FIELDS} }
  }
  ... on TamperOperationQueryRaw {
    matcher { ${TAMPER_MATCHER_RAW_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_OPERATION_BODY_FIELDS = `
  __typename
  ... on TamperOperationBodyRaw {
    matcher { ${TAMPER_MATCHER_RAW_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_OPERATION_ALL_FIELDS = `
  __typename
  ... on TamperOperationAllRaw {
    matcher { ${TAMPER_MATCHER_RAW_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_OPERATION_PATH_FIELDS = `
  __typename
  ... on TamperOperationPathRaw {
    matcher { ${TAMPER_MATCHER_RAW_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_OPERATION_FIRST_LINE_FIELDS = `
  __typename
  ... on TamperOperationFirstLineRaw {
    matcher { ${TAMPER_MATCHER_RAW_FIELDS} }
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_OPERATION_METHOD_FIELDS = `
  __typename
  ... on TamperOperationMethodUpdate {
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_OPERATION_SNI_FIELDS = `
  __typename
  ... on TamperOperationSNIRaw {
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_OPERATION_STATUS_FIELDS = `
  __typename
  ... on TamperOperationStatusCodeUpdate {
    replacer { ${TAMPER_REPLACER_FIELDS} }
  }
`;

const TAMPER_SECTION_FIELDS = `
  __typename
  ... on TamperSectionRequestHeader { operation { ${TAMPER_OPERATION_HEADER_FIELDS} } }
  ... on TamperSectionRequestBody { operation { ${TAMPER_OPERATION_BODY_FIELDS} } }
  ... on TamperSectionRequestAll { operation { ${TAMPER_OPERATION_ALL_FIELDS} } }
  ... on TamperSectionRequestFirstLine { operation { ${TAMPER_OPERATION_FIRST_LINE_FIELDS} } }
  ... on TamperSectionRequestMethod { operation { ${TAMPER_OPERATION_METHOD_FIELDS} } }
  ... on TamperSectionRequestPath { operation { ${TAMPER_OPERATION_PATH_FIELDS} } }
  ... on TamperSectionRequestQuery { operation { ${TAMPER_OPERATION_QUERY_FIELDS} } }
  ... on TamperSectionRequestSNI { operation { ${TAMPER_OPERATION_SNI_FIELDS} } }
  ... on TamperSectionResponseHeader { operation { ${TAMPER_OPERATION_HEADER_FIELDS} } }
  ... on TamperSectionResponseBody { operation { ${TAMPER_OPERATION_BODY_FIELDS} } }
  ... on TamperSectionResponseAll { operation { ${TAMPER_OPERATION_ALL_FIELDS} } }
  ... on TamperSectionResponseFirstLine { operation { ${TAMPER_OPERATION_FIRST_LINE_FIELDS} } }
  ... on TamperSectionResponseStatusCode { operation { ${TAMPER_OPERATION_STATUS_FIELDS} } }
`;

const TAMPER_RULE_ERROR_FIELDS = `
  __typename
  ... on InvalidRegexUserError { code term }
  ... on InvalidHTTPQLUserError { code query }
  ... on OtherUserError { code }
`;

const TAMPER_TEST_ERROR_FIELDS = `
  __typename
  ... on InvalidRegexUserError { code term }
  ... on OtherUserError { code }
`;

export const LIST_TAMPER_RULE_COLLECTIONS_QUERY = `
  query tamperRuleCollections {
    tamperRuleCollections {
      id
      name
      rules {
        id
        name
        enable {
          rank
        }
        condition
        sources
        section {
          ${TAMPER_SECTION_FIELDS}
        }
      }
    }
  }
`;

export const GET_TAMPER_RULE_COLLECTION_QUERY = `
  query tamperRuleCollection($id: ID!) {
    tamperRuleCollection(id: $id) {
      id
      name
      rules {
        id
        name
        enable {
          rank
        }
        condition
        sources
        section {
          ${TAMPER_SECTION_FIELDS}
        }
      }
    }
  }
`;

export const GET_TAMPER_RULE_QUERY = `
  query tamperRule($id: ID!) {
    tamperRule(id: $id) {
      id
      name
      enable {
        rank
      }
      condition
      sources
      collection {
        id
        name
      }
      section {
        ${TAMPER_SECTION_FIELDS}
      }
    }
  }
`;

export const CREATE_TAMPER_RULE_COLLECTION_MUTATION = `
  mutation createTamperRuleCollection($input: CreateTamperRuleCollectionInput!) {
    createTamperRuleCollection(input: $input) {
      collection {
        id
        name
      }
    }
  }
`;

export const RENAME_TAMPER_RULE_COLLECTION_MUTATION = `
  mutation renameTamperRuleCollection($id: ID!, $name: String!) {
    renameTamperRuleCollection(id: $id, name: $name) {
      collection {
        id
        name
      }
    }
  }
`;

export const DELETE_TAMPER_RULE_COLLECTION_MUTATION = `
  mutation deleteTamperRuleCollection($id: ID!) {
    deleteTamperRuleCollection(id: $id) {
      deletedId
    }
  }
`;

export const CREATE_TAMPER_RULE_MUTATION = `
  mutation createTamperRule($input: CreateTamperRuleInput!) {
    createTamperRule(input: $input) {
      rule {
        id
        name
        enable {
          rank
        }
        condition
        sources
        section {
          ${TAMPER_SECTION_FIELDS}
        }
      }
      error {
        ${TAMPER_RULE_ERROR_FIELDS}
      }
    }
  }
`;

export const UPDATE_TAMPER_RULE_MUTATION = `
  mutation updateTamperRule($id: ID!, $input: UpdateTamperRuleInput!) {
    updateTamperRule(id: $id, input: $input) {
      rule {
        id
        name
        enable {
          rank
        }
        condition
        sources
        section {
          ${TAMPER_SECTION_FIELDS}
        }
      }
      error {
        ${TAMPER_RULE_ERROR_FIELDS}
      }
    }
  }
`;

export const RENAME_TAMPER_RULE_MUTATION = `
  mutation renameTamperRule($id: ID!, $name: String!) {
    renameTamperRule(id: $id, name: $name) {
      rule {
        id
        name
      }
    }
  }
`;

export const DELETE_TAMPER_RULE_MUTATION = `
  mutation deleteTamperRule($id: ID!) {
    deleteTamperRule(id: $id) {
      deletedId
    }
  }
`;

export const TOGGLE_TAMPER_RULE_MUTATION = `
  mutation toggleTamperRule($id: ID!, $enabled: Boolean!) {
    toggleTamperRule(id: $id, enabled: $enabled) {
      rule {
        id
        enable {
          rank
        }
      }
    }
  }
`;

export const MOVE_TAMPER_RULE_MUTATION = `
  mutation moveTamperRule($id: ID!, $collectionId: ID!) {
    moveTamperRule(id: $id, collectionId: $collectionId) {
      rule {
        id
        collection { id name }
      }
    }
  }
`;

export const RANK_TAMPER_RULE_MUTATION = `
  mutation rankTamperRule($id: ID!, $input: RankTamperRuleInput!) {
    rankTamperRule(id: $id, input: $input) {
      rule {
        id
      }
    }
  }
`;

export const TEST_TAMPER_RULE_MUTATION = `
  mutation testTamperRule($input: TestTamperRuleInput!) {
    testTamperRule(input: $input) {
      raw
      error {
        ${TAMPER_TEST_ERROR_FIELDS}
      }
    }
  }
`;

export const EXPORT_TAMPER_MUTATION = `
  mutation exportTamper {
    exportTamper {
      export {
        id
        downloadUri
      }
      error {
        __typename
        ... on PermissionDeniedUserError {
          code
          permissionDeniedReason: reason
        }
        ... on OtherUserError {
          code
        }
      }
    }
  }
`;

export const EXPORT_TAMPER_WITH_TARGET_MUTATION = `
  mutation exportTamper($input: ExportTamperInput!) {
    exportTamper(input: $input) {
      export {
        id
        downloadUri
      }
      error {
        __typename
        ... on PermissionDeniedUserError {
          code
          permissionDeniedReason: reason
        }
        ... on OtherUserError {
          code
        }
      }
    }
  }
`;
