import type { RequestOrderField, ResponseOrderField } from "caido:utils";
import { z } from "zod";

import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import type { SerializationOptions } from "./shared";
import {
    HTTPQL_HELP_SHORT,
    serializeRequest,
    serializeResponse,
    stringifyResult,
    toCursor,
    toId,
    validateHttpqlClause,
} from "./shared";

export const registerRequestTools = ({
    server,
    sdk,
    store,
    permissions,
    toolsByAction,
}: ToolContext) => {
    const requestIdSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const requestIdArraySchema = z.array(requestIdSchema).min(1);
    const serializationSchema = z
        .object({
            includeBody: z.boolean().optional(),
            includeBinary: z.boolean().optional(),
            maxBinaryBytes: z.number().int().min(0).optional(),
        })
        .strict();
    const requestsGetSchema = z
        .object({
            requestIds: requestIdArraySchema,
            serialization: serializationSchema.optional(),
        })
        .strict();
    const requestsGetRawSchema = z.object({ requestIds: requestIdArraySchema }).strict();
    const requestsMatchesSchema = z
        .object({
            filter: z.string().min(1),
            requestIds: requestIdArraySchema,
            responseIds: requestIdArraySchema.optional(),
        })
        .strict();
    const orderSchema = z.preprocess(
        (value) =>
            value !== null &&
            value !== undefined &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            Object.keys(value).length === 0
                ? undefined
                : value,
        z
            .discriminatedUnion("target", [
                z
                    .object({
                        target: z.literal("req"),
                        field: z.enum([
                            "ext",
                            "host",
                            "id",
                            "method",
                            "path",
                            "query",
                            "created_at",
                            "source",
                        ]),
                        direction: z.enum(["asc", "desc"]).optional(),
                    })
                    .strict(),
                z
                    .object({
                        target: z.literal("resp"),
                        field: z.enum(["length", "roundtrip", "code"]),
                        direction: z.enum(["asc", "desc"]).optional(),
                    })
                    .strict(),
            ])
            .optional(),
    );
    const requestsQuerySchema = z
        .object({
            filter: z.string().min(1).optional(),
            limit: z.number().int().min(1).max(500).optional(),
            cursor: z.string().min(1).optional(),
            direction: z.enum(["after", "before"]).optional(),
            order: orderSchema,
            serialization: serializationSchema.optional(),
        })
        .strict();
    const requestSendTimeoutsSchema = z
        .object({
            connect: z.number().int().min(0).optional(),
            partial: z.number().int().min(0).optional(),
            extra: z.number().int().min(0).optional(),
            response: z.number().int().min(0).optional(),
            global: z.number().int().min(0).optional(),
        })
        .strict();
    const requestSendOptionsSchema = z
        .object({
            timeouts: z.union([z.number().int().min(0), requestSendTimeoutsSchema]).optional(),
            save: z.boolean().optional(),
            plugins: z.boolean().optional(),
        })
        .strict();
    const requestSendSchema = z
        .object({
            requestIds: requestIdArraySchema,
            options: requestSendOptionsSchema.nullable().optional(),
            serialization: serializationSchema.optional(),
        })
        .strict();
    const requestInScopeSchema = z
        .object({
            items: z
                .array(
                    z.object({
                        requestIds: requestIdArraySchema,
                        scopeIds: z.preprocess(
                            (value) => (value === null ? undefined : value),
                            z.array(z.string().min(1)).optional(),
                        ),
                    }),
                )
                .min(1),
        })
        .strict();

    toolsByAction.set(
        "sdk.requests.get",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.requests.get",
            group: ToolGroupId.RequestSafe,
            toolName: "get-request",
            description:
                "Get saved requests by ID. " +
                'Example: { "requestIds": [1] }. ' +
                "Bodies are included by default; set serialization.includeBody=false to omit.",
            inputSchema: requestsGetSchema,
            handler: async (params) => {
                const { requestIds, serialization } = params as {
                    requestIds: string[];
                    serialization?: SerializationOptions;
                };
                const results = [];
                for (const id of requestIds) {
                    const entry = await sdk.requests.get(toId(id));
                    if (entry?.request === undefined) {
                        results.push({
                            requestId: id,
                            request: null,
                            response: null,
                            error: "not found",
                        });
                        continue;
                    }
                    results.push({
                        requestId: id,
                        request: serializeRequest(entry.request, serialization),
                        response: serializeResponse(entry.response, serialization),
                    });
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            },
        }),
    );

    toolsByAction.set(
        "sdk.requests.getRaw",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.requests.getRaw",
            group: ToolGroupId.RequestSafe,
            toolName: "get-request-raw",
            description: 'Get raw request/response text by ID. Example: { "requestIds": [1] }.',
            inputSchema: requestsGetRawSchema,
            handler: async (params) => {
                const { requestIds } = params as { requestIds: string[] };
                const results = [];
                for (const id of requestIds) {
                    const entry = await sdk.requests.get(toId(id));
                    const request = entry?.request;
                    if (request === undefined) {
                        results.push({
                            requestId: id,
                            rawRequest: null,
                            rawResponse: null,
                            error: "not found",
                        });
                        continue;
                    }
                    const rawRequest = request.getRaw()?.toText() ?? null;
                    const rawResponse = entry?.response?.getRaw?.()?.toText?.() ?? null;
                    results.push({ requestId: id, rawRequest, rawResponse });
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            },
        }),
    );

    toolsByAction.set(
        "sdk.requests.matches",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.requests.matches",
            group: ToolGroupId.RequestSafe,
            toolName: "match-request",
            description:
                "Check requests against an HTTPQL filter. " +
                'Example: { "filter": "req.method.eq:\\"POST\\"", "requestIds": [1] }.' +
                "\n\n" +
                HTTPQL_HELP_SHORT,
            inputSchema: requestsMatchesSchema,
            handler: async (params) => {
                const { filter, requestIds, responseIds } = params as {
                    filter: string;
                    requestIds: string[];
                    responseIds?: string[];
                };
                const validationError = await validateHttpqlClause(sdk, filter);
                if (validationError !== null) {
                    return {
                        content: [
                            { type: "text", text: stringifyResult({ error: validationError }) },
                        ],
                    };
                }
                if (responseIds !== undefined && responseIds.length !== requestIds.length) {
                    return {
                        content: [
                            { type: "text", text: "responseIds must match requestIds length" },
                        ],
                    };
                }
                const results = [];
                for (let i = 0; i < requestIds.length; i++) {
                    const id = requestIds[i];
                    if (id === undefined || id === "") {
                        results.push({ requestId: "", matches: false, error: "requestId missing" });
                        continue;
                    }
                    const entry = await sdk.requests.get(toId(id));
                    const request = entry?.request;
                    if (request === undefined) {
                        results.push({ requestId: id, matches: false, error: "request not found" });
                        continue;
                    }
                    const response = entry?.response;
                    const matches = sdk.requests.matches(filter, request, response);
                    results.push({ requestId: id, matches });
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            },
        }),
    );

    toolsByAction.set(
        "sdk.requests.query",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.requests.query",
            group: ToolGroupId.RequestSafe,
            toolName: "query-requests",
            description:
                "Query saved requests with cursor pagination. " +
                'Example: { "filter": "req.path.cont:\\"/api/\\"", "limit": 50 }. ' +
                "Cursor comes from pageInfo.startCursor/endCursor or items[].cursor. " +
                "Bodies are omitted by default; set serialization.includeBody=true to include." +
                "\n\n" +
                HTTPQL_HELP_SHORT,
            inputSchema: requestsQuerySchema,
            handler: async (params) => {
                const { filter, limit, cursor, direction, order, serialization } = params as {
                    filter?: string;
                    limit?: number;
                    cursor?: string;
                    direction?: "after" | "before";
                    order?:
                        | { target: "req"; field: RequestOrderField; direction?: "asc" | "desc" }
                        | { target: "resp"; field: ResponseOrderField; direction?: "asc" | "desc" };
                    serialization?: SerializationOptions;
                };
                let query = sdk.requests.query();
                if (filter !== undefined && filter !== "") {
                    const validationError = await validateHttpqlClause(sdk, filter);
                    if (validationError !== null) {
                        return {
                            content: [
                                { type: "text", text: stringifyResult({ error: validationError }) },
                            ],
                        };
                    }
                    query = query.filter(filter);
                }
                if (cursor !== undefined && direction === "before") {
                    query = query.before(toCursor(cursor));
                }
                if (cursor !== undefined && direction !== "before") {
                    query = query.after(toCursor(cursor));
                }
                const resolvedOrder =
                    order ?? ({ target: "req", field: "id", direction: "asc" } as const);
                const orderDirection = resolvedOrder.direction ?? "asc";
                if (resolvedOrder.target === "req") {
                    query =
                        orderDirection === "asc"
                            ? query.ascending("req", resolvedOrder.field)
                            : query.descending("req", resolvedOrder.field);
                } else {
                    query =
                        orderDirection === "asc"
                            ? query.ascending("resp", resolvedOrder.field)
                            : query.descending("resp", resolvedOrder.field);
                }
                if (limit !== undefined) {
                    query = direction === "before" ? query.last(limit) : query.first(limit);
                }
                const result = await query.execute();
                const resolvedSerialization: SerializationOptions = serialization ?? {
                    includeBody: false,
                };
                const items = result.items.map((item) => ({
                    cursor: String(item.cursor),
                    request: serializeRequest(item.request, resolvedSerialization),
                    response: serializeResponse(item.response, resolvedSerialization),
                }));
                const pageInfo = {
                    hasNextPage: result.pageInfo.hasNextPage,
                    hasPreviousPage: result.pageInfo.hasPreviousPage,
                    startCursor: String(result.pageInfo.startCursor),
                    endCursor: String(result.pageInfo.endCursor),
                };
                return {
                    content: [{ type: "text", text: stringifyResult({ items, pageInfo }) }],
                };
            },
        }),
    );

    toolsByAction.set(
        "sdk.requests.send",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.requests.send",
            group: ToolGroupId.RequestUnsafe,
            toolName: "send-request",
            description:
                "Send saved requests by ID. " +
                'Example: { "requestIds": [1] }. ' +
                "Bodies are included by default; set serialization.includeBody=false to omit.",
            inputSchema: requestSendSchema,
            handler: async (params) => {
                const input = requestSendSchema.parse(params);
                const { requestIds, serialization } = input;
                const typedOptions:
                    | {
                          timeouts?:
                              | number
                              | {
                                    connect?: number;
                                    partial?: number;
                                    extra?: number;
                                    response?: number;
                                    global?: number;
                                };
                          save?: boolean;
                          plugins?: boolean;
                      }
                    | undefined = input.options ?? undefined;
                const results = [];
                for (const id of requestIds) {
                    const entry = await sdk.requests.get(toId(id));
                    const request = entry?.request;
                    if (request === undefined) {
                        results.push({
                            requestId: id,
                            sentRequestId: null,
                            response: null,
                            error: "not found",
                        });
                        continue;
                    }
                    try {
                        const spec = request.toSpec();
                        const payload = await sdk.requests.send(spec, typedOptions ?? {});
                        results.push({
                            requestId: id,
                            sentRequestId: String(payload.request.getId()),
                            response: serializeResponse(payload.response, serialization),
                        });
                    } catch (err) {
                        results.push({
                            requestId: id,
                            sentRequestId: null,
                            response: null,
                            error: String(err),
                        });
                    }
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            },
        }),
    );

    toolsByAction.set(
        "sdk.requests.inScope",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.requests.inScope",
            group: ToolGroupId.RequestSafe,
            toolName: "is-request-in-scope",
            description:
                "Check whether requests are in scope. " +
                'Example: { "items": [{ "requestIds": [1], "scopeIds": [1] }] }.',
            inputSchema: requestInScopeSchema,
            handler: async (params) => {
                const results = [];
                for (const { requestIds, scopeIds } of (
                    params as {
                        items: { requestIds: string[]; scopeIds?: string[] }[];
                    }
                ).items) {
                    const scopes =
                        scopeIds !== undefined ? scopeIds.map((id) => toId(id)) : undefined;
                    for (const requestId of requestIds) {
                        const entry = await sdk.requests.get(toId(requestId));
                        const request = entry?.request;
                        if (request === undefined) {
                            results.push({ requestId, inScope: false, error: "request not found" });
                            continue;
                        }
                        const inScope = scopes
                            ? sdk.requests.inScope(request, scopes)
                            : sdk.requests.inScope(request);
                        results.push({ requestId, inScope });
                    }
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            },
        }),
    );
};
