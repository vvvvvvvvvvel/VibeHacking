import { Buffer } from "buffer";

import type { ReplayCollection } from "caido:utils";
import { z } from "zod";

import {
    CREATE_REPLAY_COLLECTION_MUTATION,
    DELETE_REPLAY_COLLECTION_MUTATION,
    DELETE_REPLAY_SESSIONS_MUTATION,
    GET_REPLAY_ENTRY_QUERY,
    GET_REPLAY_SESSION_QUERY,
    LIST_REPLAY_COLLECTIONS_DETAILED_QUERY,
    LIST_REPLAY_COLLECTIONS_QUERY,
    LIST_REPLAY_SESSIONS_QUERY,
    MOVE_REPLAY_SESSION_MUTATION,
    RENAME_REPLAY_COLLECTION_MUTATION,
    RENAME_REPLAY_SESSION_MUTATION,
    START_REPLAY_TASK_MUTATION,
} from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import type { SerializationOptions } from "./shared";
import {
    HTTPQL_HELP_SHORT,
    serializeRequest,
    serializeResponse,
    stringifyResult,
    toId,
    validateHttpqlClause,
} from "./shared";

type RenameReplayCollectionResponse = {
    renameReplaySessionCollection?: { collection?: { id: string; name: string } };
};

type RenameReplaySessionResponse = {
    renameReplaySession?: { session?: { id: string; name: string } };
};

type CreateReplayCollectionResponse = {
    createReplaySessionCollection?: { collection?: { id: string; name: string } };
};

type DeleteReplayCollectionResponse = {
    deleteReplaySessionCollection?: { deletedId?: string };
};

type DeleteReplaySessionsResponse = {
    deleteReplaySessions?: { deletedIds?: Array<string> };
};

type ReplayCollectionsResponse = {
    replaySessionCollections?: {
        pageInfo: {
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            startCursor?: string;
            endCursor?: string;
        };
        nodes: Array<{ id: string; name: string }>;
    };
};

type ReplayCollectionsDetailedResponse = {
    replaySessionCollections?: {
        pageInfo: {
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            startCursor?: string;
            endCursor?: string;
        };
        nodes: Array<{
            id: string;
            name: string;
            sessions: Array<{
                id: string;
                name: string;
                activeEntry?: { id: string };
                entries: {
                    count: { value: number };
                    nodes: Array<{
                        id: string;
                        error?: string;
                        createdAt: string;
                        raw?: string;
                        request?: { id: string };
                    }>;
                };
            }>;
        }>;
    };
};

type ReplaySessionsResponse = {
    replaySessions?: {
        pageInfo: {
            hasNextPage: boolean;
            hasPreviousPage: boolean;
            startCursor?: string;
            endCursor?: string;
        };
        nodes: Array<{
            id: string;
            name: string;
            collection?: { id: string; name: string };
        }>;
    };
};

type ReplaySessionResponse = {
    replaySession?: { id: string; name: string; collection?: { id: string; name: string } };
};

type ReplayEntryResponse = {
    replayEntry?: {
        id: string;
        error?: string;
        raw?: string;
        connection?: { host: string; port: number; isTLS: boolean; SNI?: string };
        session?: { id: string };
        request?: {
            id: string;
            host: string;
            port: number;
            path: string;
            query?: string;
            method: string;
            createdAt: string;
            response?: { id: string; statusCode: number };
        };
    };
};

type MoveReplaySessionResponse = {
    moveReplaySession?: {
        session?: { id: string; name: string; collection?: { id: string; name: string } };
    };
};

type StartReplayTaskResponse = {
    startReplayTask?: {
        task?: {
            id: string;
            createdAt: string;
            replayEntry?: { id: string; session?: { id: string } };
        };
    };
};

const idSchema = z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().min(1),
);

const replayCreateSessionSchema = z
    .object({
        requestIds: z.array(idSchema).min(1),
        collectionId: idSchema.optional(),
    })
    .strict();

const replayCollectionSchema = z.object({ id: idSchema, name: z.string().min(1) }).strict();
const replaySessionSchema = z.object({ id: idSchema, name: z.string().min(1) }).strict();
const replayCreateCollectionBatchSchema = z.array(z.string().min(1)).min(1);
const replayRenameCollectionBatchSchema = z.array(replayCollectionSchema).min(1);
const replayRenameSessionBatchSchema = z.array(replaySessionSchema).min(1);
const replayDeleteCollectionSchema = z.union([
    z.object({ ids: z.array(idSchema).min(1) }).strict(),
    z.object({ items: z.array(idSchema).min(1) }).strict(),
]);
const replayDeleteSessionsSchema = z.object({ ids: z.array(idSchema).min(1) }).strict();
const moveReplaySessionBatchSchema = z
    .array(
        z
            .object({
                ids: z.array(idSchema).min(1),
                collectionId: idSchema,
            })
            .strict(),
    )
    .min(1);
const replayGetSessionSchema = z.object({ sessionIds: z.array(idSchema).min(1) }).strict();
const replayCreateCollectionSchema = z
    .object({ names: replayCreateCollectionBatchSchema })
    .strict();
const moveReplaySessionSchema = z.object({ items: moveReplaySessionBatchSchema }).strict();
const replayRenameCollectionSchema = z
    .object({ items: replayRenameCollectionBatchSchema })
    .strict();
const replayRenameSessionSchema = z.object({ items: replayRenameSessionBatchSchema }).strict();

const paginationSchema = z
    .object({
        first: z.number().int().min(1).max(5000).optional(),
        after: z.string().min(1).optional(),
        last: z.number().int().min(1).max(5000).optional(),
        before: z.string().min(1).optional(),
    })
    .strict();

const serializationSchema = z
    .object({
        includeBody: z.boolean().optional(),
        includeBinary: z.boolean().optional(),
        maxBinaryBytes: z.number().int().min(0).optional(),
    })
    .strict();

const detailedCollectionsSchema = paginationSchema.extend({
    includeRequest: z.boolean().optional(),
    onlyLatestEntryDetails: z.boolean().optional(),
    includeRawWhenRequestMissing: z.boolean().optional(),
    serialization: serializationSchema.optional(),
});

const replayEntrySchema = z
    .object({
        entryIds: z.array(idSchema).min(1),
        includeRequest: z.boolean().optional(),
        includeRawWhenRequestMissing: z.boolean().optional(),
        serialization: serializationSchema.optional(),
    })
    .strict();

const optionalIdSchema = z.preprocess(
    (value) => (value === "" ? undefined : value),
    idSchema.optional(),
);
const optionalNameSchema = z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
);

const sendToReplaySchema = z
    .object({
        requestIds: z.array(idSchema).min(1),
        collectionId: optionalIdSchema,
        collectionName: optionalNameSchema,
        sessionName: optionalNameSchema,
        createCollectionIfMissing: z.boolean().optional(),
    })
    .strict()
    .refine(
        (value) => value.collectionId !== undefined || value.collectionName !== undefined,
        "Provide collectionId or collectionName",
    );

const sendToReplayFromFilterSchema = z
    .object({
        filter: z.string().min(1),
        limit: z.number().int().min(1).max(500).optional(),
        collectionId: optionalIdSchema,
        collectionName: optionalNameSchema,
        sessionName: optionalNameSchema,
        createCollectionIfMissing: z.boolean().optional(),
    })
    .strict()
    .refine(
        (value) => value.collectionId !== undefined || value.collectionName !== undefined,
        "Provide collectionId or collectionName",
    );

const startReplayTaskItemSchema = z
    .object({
        sessionId: idSchema,
        rawBase64: z.string().min(1),
        connection: z.object({
            host: z.string().min(1),
            port: z.number().int().min(1),
            isTLS: z.boolean(),
            SNI: z.string().min(1).optional(),
        }),
        settings: z
            .object({
                placeholders: z.array(z.unknown()),
                updateContentLength: z.boolean(),
                connectionClose: z.boolean(),
            })
            .optional(),
    })
    .strict();

const startReplayTaskSchema = z.union([
    z.object({ items: z.array(startReplayTaskItemSchema).min(1) }).strict(),
    z
        .object({
            sessionIds: z.array(idSchema).min(1),
            rawBase64: z.string().min(1),
            connection: z.object({
                host: z.string().min(1),
                port: z.number().int().min(1),
                isTLS: z.boolean(),
                SNI: z.string().min(1).optional(),
            }),
            settings: z
                .object({
                    placeholders: z.array(z.unknown()),
                    updateContentLength: z.boolean(),
                    connectionClose: z.boolean(),
                })
                .optional(),
        })
        .strict(),
]);

const decodeRawBase64 = (rawBase64: string | undefined) => {
    if (rawBase64 === undefined || rawBase64 === "") return undefined;
    try {
        return Buffer.from(rawBase64, "base64").toString("utf8");
    } catch {
        return undefined;
    }
};

export const registerReplayTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const resolveReplayCollection = async ({
        collectionId: inputCollectionId,
        collectionName,
        createCollectionIfMissing,
    }: {
        collectionId?: string;
        collectionName?: string;
        createCollectionIfMissing?: boolean;
    }) => {
        const shouldCreateCollection = createCollectionIfMissing ?? true;
        let collectionId: string | undefined;
        let collectionResolved: { id: string; name: string } | undefined;
        let collectionRef: ReplayCollection | undefined;
        const resolveCollections = async () => sdk.replay.getCollections();
        const resolveByName = async (name: string) => {
            const collections = await resolveCollections();
            return collections.find((item) => item.getName() === name);
        };

        if (inputCollectionId !== undefined && inputCollectionId !== "") {
            const collections = await resolveCollections();
            const resolved = collections.find((item) => String(item.getId()) === inputCollectionId);
            if (resolved) {
                collectionId = String(resolved.getId());
                collectionResolved = { id: collectionId, name: resolved.getName() };
                collectionRef = resolved;
            } else {
                collectionId = inputCollectionId;
                collectionResolved = {
                    id: inputCollectionId,
                    name: collectionName ?? inputCollectionId,
                };
            }
        } else if (collectionName !== undefined && collectionName !== "") {
            const collections = await resolveCollections();
            const existing = collections.find(
                (collection) => collection.getName() === collectionName,
            );
            if (existing) {
                collectionId = String(existing.getId());
                collectionResolved = { id: collectionId, name: existing.getName() };
                collectionRef = existing;
            } else if (shouldCreateCollection) {
                const created = await sdk.graphql.execute<CreateReplayCollectionResponse>(
                    CREATE_REPLAY_COLLECTION_MUTATION,
                    { input: { name: collectionName } },
                );
                const collection = created.data?.createReplaySessionCollection?.collection;
                if (collection !== undefined && collection !== null) {
                    const resolved = await resolveByName(collection.name);
                    if (resolved !== undefined) {
                        collectionId = String(resolved.getId());
                        collectionResolved = { id: collectionId, name: resolved.getName() };
                        collectionRef = resolved;
                    } else {
                        collectionId = collection.id;
                        collectionResolved = { id: collection.id, name: collection.name };
                    }
                }
            }
        }

        return {
            collectionId,
            collectionResolved,
            collectionRef,
            shouldCreateCollection,
        };
    };

    const sendToReplayInternal = async ({
        requestIds,
        collectionId: inputCollectionId,
        collectionName,
        sessionName,
        createCollectionIfMissing,
    }: {
        requestIds: string[];
        collectionId?: string;
        collectionName?: string;
        sessionName?: string;
        createCollectionIfMissing?: boolean;
    }) => {
        const { collectionId, collectionResolved, collectionRef, shouldCreateCollection } =
            await resolveReplayCollection({
                collectionId: inputCollectionId,
                collectionName,
                createCollectionIfMissing,
            });

        if (
            collectionName !== undefined &&
            collectionName !== "" &&
            collectionId === undefined &&
            !shouldCreateCollection
        ) {
            return {
                collection: { name: collectionName },
                createdCount: 0,
                failedCount: requestIds.length,
                sessions: requestIds.map((requestId) => ({
                    requestId,
                    error: `collection not found: ${collectionName}`,
                })),
            };
        }

        const results: Array<{
            requestId: string;
            sessionId?: string;
            sessionName?: string;
            error?: string;
        }> = [];

        for (const [index, requestId] of requestIds.entries()) {
            try {
                const requestPair = await sdk.requests.get(toId(requestId));
                if (requestPair?.request === undefined) {
                    results.push({ requestId, error: "request not found" });
                    continue;
                }
                const session = await sdk.replay.createSession(
                    requestPair.request,
                    collectionRef ??
                        (collectionId !== undefined && collectionId !== ""
                            ? toId(collectionId)
                            : undefined),
                );
                const createdId = String(session.getId());
                if (collectionId !== undefined) {
                    await sdk.graphql.execute<MoveReplaySessionResponse>(
                        MOVE_REPLAY_SESSION_MUTATION,
                        {
                            id: createdId,
                            collectionId,
                        },
                    );
                }
                let resolvedName = session.getName();
                if (sessionName !== undefined && sessionName !== "") {
                    resolvedName =
                        requestIds.length === 1 ? sessionName : `${sessionName} #${index + 1}`;
                    const renamed = await sdk.graphql.execute<RenameReplaySessionResponse>(
                        RENAME_REPLAY_SESSION_MUTATION,
                        { id: createdId, name: resolvedName },
                    );
                    resolvedName = renamed.data?.renameReplaySession?.session?.name ?? resolvedName;
                }
                results.push({ requestId, sessionId: createdId, sessionName: resolvedName });
            } catch (error) {
                results.push({
                    requestId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        return {
            collection:
                collectionResolved ??
                (collectionName !== undefined && collectionName !== ""
                    ? { name: collectionName }
                    : undefined),
            createdCount: results.filter((item) => item.sessionId !== undefined).length,
            failedCount: results.filter((item) => item.error !== undefined).length,
            sessions: results,
        };
    };

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.listCollectionsGql",
        group: ToolGroupId.ReplaySafe,
        toolName: "query-replay-collections",
        description: 'List Replay collections with cursor pagination. Example: { "first": 20 }.',
        inputSchema: paginationSchema,
        handler: async (params) => {
            const response = await sdk.graphql.execute<ReplayCollectionsResponse>(
                LIST_REPLAY_COLLECTIONS_QUERY,
                params,
            );
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.listCollectionsDetailed",
        group: ToolGroupId.ReplaySafe,
        toolName: "list-replay-collections-detailed",
        description:
            "List Replay collections with nested sessions and entries. " +
            'Example: { "first": 5, "includeRequest": true }. ' +
            "If includeRequest is true, requestDetails/responseDetails are added. " +
            "If onlyLatestEntryDetails is true (default), only the latest entry with a request is expanded per session; " +
            "other entries include only request.id. If false, all entries with requests are expanded. " +
            "Bodies are omitted by default; set serialization.includeBody=true to include. " +
            "If a request is missing, raw is returned by default; set includeRawWhenRequestMissing=false to omit.",
        inputSchema: detailedCollectionsSchema,
        handler: async (params) => {
            const {
                includeRequest,
                onlyLatestEntryDetails,
                includeRawWhenRequestMissing,
                serialization,
                ...pagination
            } = params as {
                includeRequest?: boolean;
                onlyLatestEntryDetails?: boolean;
                includeRawWhenRequestMissing?: boolean;
                serialization?: SerializationOptions;
                first?: number;
                after?: string;
                last?: number;
                before?: string;
            };
            const resolvedIncludeRequest = includeRequest ?? true;
            const resolvedOnlyLatestEntryDetails = onlyLatestEntryDetails ?? true;
            const resolvedIncludeRawWhenMissing = includeRawWhenRequestMissing ?? true;
            const response = await sdk.graphql.execute<ReplayCollectionsDetailedResponse>(
                LIST_REPLAY_COLLECTIONS_DETAILED_QUERY,
                pagination,
            );
            const data = response.data;
            if (
                !resolvedIncludeRequest ||
                data?.replaySessionCollections === undefined ||
                data.replaySessionCollections === null
            ) {
                return { content: [{ type: "text", text: stringifyResult(data ?? response) }] };
            }

            const requestIds = new Set<string>();
            for (const collection of data.replaySessionCollections.nodes) {
                for (const session of collection.sessions) {
                    const entriesWithRequest = session.entries.nodes.filter(
                        (entry) => entry.request?.id !== undefined,
                    );
                    if (resolvedOnlyLatestEntryDetails) {
                        const latest = entriesWithRequest.at(-1);
                        if (latest?.request?.id !== undefined) {
                            requestIds.add(latest.request.id);
                        }
                    } else {
                        for (const entry of entriesWithRequest) {
                            if (entry.request?.id !== undefined) {
                                requestIds.add(entry.request.id);
                            }
                        }
                    }
                }
            }

            const requestMap = new Map<
                string,
                { requestDetails: unknown; responseDetails: unknown }
            >();
            const resolvedSerialization: SerializationOptions = serialization ?? {
                includeBody: false,
            };
            await Promise.all(
                Array.from(requestIds).map(async (requestId) => {
                    const requestPair = await sdk.requests.get(toId(requestId));
                    if (requestPair?.request === undefined) {
                        requestMap.set(requestId, { requestDetails: null, responseDetails: null });
                        return;
                    }
                    requestMap.set(requestId, {
                        requestDetails: serializeRequest(
                            requestPair.request,
                            resolvedSerialization,
                        ),
                        responseDetails: serializeResponse(
                            requestPair.response,
                            resolvedSerialization,
                        ),
                    });
                }),
            );

            const enriched = {
                ...data,
                replaySessionCollections: {
                    ...data.replaySessionCollections,
                    nodes: data.replaySessionCollections.nodes.map((collection) => ({
                        ...collection,
                        sessions: collection.sessions.map((session) => ({
                            ...session,
                            entries: {
                                ...session.entries,
                                nodes: session.entries.nodes.map((entry) => {
                                    const { raw, ...entryWithoutRaw } = entry;
                                    const requestId = entry.request?.id;
                                    const details =
                                        requestId !== undefined
                                            ? requestMap.get(requestId)
                                            : undefined;
                                    const rawBase64 =
                                        requestId !== undefined
                                            ? undefined
                                            : resolvedIncludeRawWhenMissing
                                              ? (entry.raw ?? undefined)
                                              : undefined;
                                    const rawUtf8 =
                                        rawBase64 !== undefined
                                            ? decodeRawBase64(rawBase64)
                                            : undefined;
                                    return {
                                        ...entryWithoutRaw,
                                        requestDetails: details?.requestDetails ?? null,
                                        responseDetails: details?.responseDetails ?? null,
                                        requestRawBase64: rawBase64 ?? null,
                                        requestRawUtf8: rawUtf8 ?? null,
                                    };
                                }),
                            },
                        })),
                    })),
                },
            };

            return { content: [{ type: "text", text: stringifyResult(enriched) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.listSessions",
        group: ToolGroupId.ReplaySafe,
        toolName: "query-replay-sessions",
        description: 'List Replay sessions with cursor pagination. Example: { "first": 20 }.',
        inputSchema: paginationSchema,
        handler: async (params) => {
            const response = await sdk.graphql.execute<ReplaySessionsResponse>(
                LIST_REPLAY_SESSIONS_QUERY,
                params,
            );
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.getSession",
        group: ToolGroupId.ReplaySafe,
        toolName: "get-replay-session",
        description: 'Get Replay sessions by ID. Example: { "sessionIds": [1] }.',
        inputSchema: replayGetSessionSchema,
        handler: async (params) => {
            const { sessionIds } = replayGetSessionSchema.parse(params);
            const results = await Promise.all(
                sessionIds.map(async (id) => {
                    const response = await sdk.graphql.execute<ReplaySessionResponse>(
                        GET_REPLAY_SESSION_QUERY,
                        { id },
                    );
                    const session = response.data?.replaySession;
                    if (session === undefined) {
                        return { id, error: response.errors ?? response.data ?? response };
                    }
                    return {
                        id: session.id,
                        name: session.name,
                        collection: session.collection ?? undefined,
                    };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.getEntry",
        group: ToolGroupId.ReplaySafe,
        toolName: "get-replay-entry",
        description:
            "Get Replay entries by ID. " +
            'Example: { "entryIds": [1], "includeRequest": true }. ' +
            "If includeRequest is true, requestDetails/responseDetails are added when available. " +
            "Bodies are included by default; set serialization.includeBody=false to omit. " +
            "If a request is missing, raw is returned by default; set includeRawWhenRequestMissing=false to omit.",
        inputSchema: replayEntrySchema,
        handler: async (params) => {
            const { entryIds, includeRequest, includeRawWhenRequestMissing, serialization } =
                replayEntrySchema.parse(params);
            const results = [];
            for (const id of entryIds) {
                const response = await sdk.graphql.execute<ReplayEntryResponse>(
                    GET_REPLAY_ENTRY_QUERY,
                    { id },
                );
                const replayEntry = response.data?.replayEntry;
                const replayEntryWithoutRaw = replayEntry
                    ? (({ raw, ...rest }) => rest)(replayEntry)
                    : null;
                if (replayEntry === undefined || includeRequest === false) {
                    results.push({
                        replayEntry: replayEntryWithoutRaw,
                        requestDetails: null,
                        responseDetails: null,
                        requestRawBase64: null,
                        requestRawUtf8: null,
                    });
                    continue;
                }
                const requestId = replayEntry.request?.id;
                if (requestId === undefined || requestId === null || requestId === "") {
                    const resolvedIncludeRawWhenMissing = includeRawWhenRequestMissing ?? true;
                    const rawBase64 = resolvedIncludeRawWhenMissing
                        ? (replayEntry.raw ?? undefined)
                        : undefined;
                    const rawUtf8 =
                        rawBase64 !== undefined ? decodeRawBase64(rawBase64) : undefined;
                    results.push({
                        replayEntry: replayEntryWithoutRaw,
                        requestDetails: null,
                        responseDetails: null,
                        requestRawBase64: rawBase64 ?? null,
                        requestRawUtf8: rawUtf8 ?? null,
                    });
                    continue;
                }
                const requestPair = await sdk.requests.get(toId(requestId));
                if (requestPair?.request === undefined) {
                    results.push({
                        replayEntry: replayEntryWithoutRaw,
                        requestDetails: null,
                        responseDetails: null,
                        requestRawBase64: null,
                        requestRawUtf8: null,
                    });
                    continue;
                }
                results.push({
                    replayEntry: replayEntryWithoutRaw,
                    requestDetails: serializeRequest(requestPair.request, serialization),
                    responseDetails: serializeResponse(requestPair.response, serialization),
                    requestRawBase64: null,
                    requestRawUtf8: null,
                });
            }
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult(results),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.createSession",
        group: ToolGroupId.ReplaySafe,
        toolName: "create-replay-session",
        description:
            "Create Replay sessions from request IDs. " +
            'Example: { "requestIds": [1], "collectionId": 1 }.',
        inputSchema: replayCreateSessionSchema,
        handler: async (params) => {
            const { requestIds, collectionId } = replayCreateSessionSchema.parse(params);
            const results = await Promise.all(
                requestIds.map(async (requestId) => {
                    const session = await sdk.replay.createSession(
                        toId(requestId),
                        collectionId !== undefined && collectionId !== ""
                            ? toId(collectionId)
                            : undefined,
                    );
                    return {
                        requestId,
                        id: String(session.getId()),
                        name: session.getName(),
                    };
                }),
            );
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.sendToReplay",
        group: ToolGroupId.ReplaySafe,
        toolName: "send-to-replay",
        description:
            "Create Replay sessions from request IDs. " +
            'Example: { "requestIds": [1], "collectionName": "My Collection" }. ' +
            "collectionName targets a collection; sessionName is the name for a single session or a prefix for many.",
        inputSchema: sendToReplaySchema,
        handler: async (params) => {
            const parsed = sendToReplaySchema.parse(params);
            const summary = await sendToReplayInternal(parsed);
            return { content: [{ type: "text", text: stringifyResult(summary) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.sendToReplayFromFilter",
        group: ToolGroupId.ReplaySafe,
        toolName: "send-to-replay-from-filter",
        description:
            "Create Replay sessions from requests matched by an HTTPQL filter. " +
            'Example: { "filter": "req.method.eq:\\"POST\\"", "collectionName": "My Collection" }.' +
            "\n\n" +
            HTTPQL_HELP_SHORT,
        inputSchema: sendToReplayFromFilterSchema,
        handler: async (params) => {
            const {
                filter,
                limit,
                collectionId,
                collectionName,
                sessionName,
                createCollectionIfMissing,
            } = sendToReplayFromFilterSchema.parse(params);
            const validationError = await validateHttpqlClause(sdk, filter);
            if (validationError !== null) {
                return {
                    content: [{ type: "text", text: stringifyResult({ error: validationError }) }],
                };
            }
            let query = sdk.requests.query().filter(filter);
            if (limit !== undefined) query = query.first(limit);
            const result = await query.execute();
            const requestIds = result.items.map((item) => String(item.request.getId()));
            const summary = await sendToReplayInternal({
                requestIds,
                collectionId,
                collectionName,
                sessionName,
                createCollectionIfMissing,
            });
            return { content: [{ type: "text", text: stringifyResult(summary) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.createCollection",
        group: ToolGroupId.ReplaySafe,
        toolName: "create-replay-collection",
        description: 'Create Replay collections. Example: { "names": ["New Collection"] }.',
        inputSchema: replayCreateCollectionSchema,
        handler: async (params) => {
            const { names } = replayCreateCollectionSchema.parse(params);
            const results = await Promise.all(
                names.map(async (name) => {
                    const response = await sdk.graphql.execute<CreateReplayCollectionResponse>(
                        CREATE_REPLAY_COLLECTION_MUTATION,
                        { input: { name } },
                    );
                    const collection = response.data?.createReplaySessionCollection?.collection;
                    if (collection === undefined || collection === null) {
                        return { name, error: response.errors ?? response.data ?? response };
                    }
                    return { name: collection.name, id: collection.id };
                }),
            );
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.moveSession",
        group: ToolGroupId.ReplaySafe,
        toolName: "move-replay-session",
        description:
            "Move Replay sessions to a collection. " +
            'Example: { "items": [{ "ids": [1, 2], "collectionId": 1 }] }.',
        inputSchema: moveReplaySessionSchema,
        handler: async (params) => {
            const { items } = moveReplaySessionSchema.parse(params);
            const results = await Promise.all(
                items.map(async (item) => {
                    const moved = await Promise.all(
                        item.ids.map(async (id) => {
                            const response = await sdk.graphql.execute<MoveReplaySessionResponse>(
                                MOVE_REPLAY_SESSION_MUTATION,
                                { id, collectionId: item.collectionId },
                            );
                            const session = response.data?.moveReplaySession?.session;
                            if (session === undefined || session === null) {
                                return { id, error: response.errors ?? response.data ?? response };
                            }
                            return {
                                id: session.id,
                                name: session.name,
                                collection: session.collection ?? null,
                            };
                        }),
                    );
                    return { collectionId: item.collectionId, results: moved };
                }),
            );
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.startTask",
        group: ToolGroupId.ReplayUnsafe,
        toolName: "start-replay-task",
        description:
            "Start Replay tasks. " +
            'Example: { "items": [{ "sessionId": 1, "rawBase64": "<base64>", "connection": { "host": "example.com", "port": 443, "isTLS": true } }] }. ' +
            "rawBase64 is base64-encoded raw HTTP; defaults apply if settings are omitted.",
        inputSchema: startReplayTaskSchema,
        handler: async (params) => {
            const parsed = startReplayTaskSchema.parse(params);
            const items =
                "items" in parsed
                    ? parsed.items
                    : parsed.sessionIds.map((sessionId) => ({
                          sessionId,
                          rawBase64: parsed.rawBase64,
                          connection: parsed.connection,
                          settings: parsed.settings,
                      }));
            const results = await Promise.all(
                items.map(async (item) => {
                    const resolvedSettings =
                        item.settings ??
                        ({
                            placeholders: [],
                            updateContentLength: true,
                            connectionClose: true,
                        } as const);
                    const response = await sdk.graphql.execute<StartReplayTaskResponse>(
                        START_REPLAY_TASK_MUTATION,
                        {
                            sessionId: item.sessionId,
                            input: {
                                connection: item.connection,
                                raw: item.rawBase64,
                                settings: resolvedSettings,
                            },
                        },
                    );
                    return { sessionId: item.sessionId, result: response.data ?? response };
                }),
            );
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.renameCollection",
        group: ToolGroupId.ReplaySafe,
        toolName: "rename-replay-collection",
        description:
            "Rename Replay collections. " +
            'Example: { "items": [{ "id": 1, "name": "Default" }] }.',
        inputSchema: replayRenameCollectionSchema,
        handler: async (params) => {
            const { items } = replayRenameCollectionSchema.parse(params);
            const results = await Promise.all(
                items.map(async ({ id, name }) => {
                    const response = await sdk.graphql.execute<RenameReplayCollectionResponse>(
                        RENAME_REPLAY_COLLECTION_MUTATION,
                        { id, name },
                    );
                    const collection = response.data?.renameReplaySessionCollection?.collection;
                    if (collection === undefined || collection === null) {
                        return { id, name, error: response.errors ?? response.data ?? response };
                    }
                    return { id: collection.id, name: collection.name };
                }),
            );
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.renameSession",
        group: ToolGroupId.ReplaySafe,
        toolName: "rename-replay-session",
        description:
            "Rename Replay sessions. " + 'Example: { "items": [{ "id": 1, "name": "Login" }] }.',
        inputSchema: replayRenameSessionSchema,
        handler: async (params) => {
            const { items } = replayRenameSessionSchema.parse(params);
            const results = await Promise.all(
                items.map(async ({ id, name }) => {
                    const response = await sdk.graphql.execute<RenameReplaySessionResponse>(
                        RENAME_REPLAY_SESSION_MUTATION,
                        { id, name },
                    );
                    const session = response.data?.renameReplaySession?.session;
                    if (session === undefined || session === null) {
                        return { id, name, error: response.errors ?? response.data ?? response };
                    }
                    return { id: session.id, name: session.name };
                }),
            );
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.deleteCollection",
        group: ToolGroupId.ReplayUnsafe,
        toolName: "delete-replay-collection",
        description: 'Delete Replay collections by ID. Example: { "items": [1, 2] }.',
        inputSchema: replayDeleteCollectionSchema,
        handler: async (params) => {
            const parsed = replayDeleteCollectionSchema.parse(params);
            const ids = "items" in parsed ? parsed.items : parsed.ids;
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute<DeleteReplayCollectionResponse>(
                        DELETE_REPLAY_COLLECTION_MUTATION,
                        { id },
                    );
                    return { id, result: response.data ?? response };
                }),
            );
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.replay.deleteSessions",
        group: ToolGroupId.ReplayUnsafe,
        toolName: "delete-replay-session",
        description: 'Delete Replay sessions by ID. Example: { "ids": [1] }.',
        inputSchema: replayDeleteSessionsSchema,
        handler: async (params) => {
            const { ids } = replayDeleteSessionsSchema.parse(params);
            const response = await sdk.graphql.execute<DeleteReplaySessionsResponse>(
                DELETE_REPLAY_SESSIONS_MUTATION,
                { ids },
            );
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });
};
