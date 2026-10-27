import type { GraphQLResponse } from "caido:utils";

import type { MCPSDK } from "../types/sdk";

const operationName = (document: string) =>
    /\b(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/.exec(document)?.[1] ??
    "anonymous operation";

export const executeGraphql = async <T>(
    sdk: Pick<MCPSDK, "graphql">,
    document: string,
    variables: Record<string, unknown> = {},
): Promise<GraphQLResponse<T>> => {
    const response = await sdk.graphql.execute<T>(document, variables);
    if (response.errors !== undefined && response.errors.length > 0) {
        const details = response.errors.map((error) => error.message).join("; ");
        throw new Error(`GraphQL ${operationName(document)} failed: ${details}`);
    }
    return response;
};

export type GraphqlExecutor = {
    execute<T>(document: string, variables?: Record<string, unknown>): Promise<GraphQLResponse<T>>;
};

export const createGraphqlExecutor = (sdk: Pick<MCPSDK, "graphql">): GraphqlExecutor => ({
    execute: <T>(document: string, variables?: Record<string, unknown>) =>
        executeGraphql<T>(sdk, document, variables),
});
