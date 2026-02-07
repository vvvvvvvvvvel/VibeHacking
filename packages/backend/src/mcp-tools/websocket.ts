import { Buffer } from "buffer";

import { z } from "zod";

import {
    GET_STREAM_QUERY,
    GET_STREAM_WS_MESSAGE_EDIT_QUERY,
    GET_STREAM_WS_MESSAGE_QUERY,
    LIST_STREAM_WS_MESSAGES_BY_OFFSET_QUERY,
    LIST_STREAM_WS_MESSAGES_QUERY,
    LIST_STREAMS_BY_OFFSET_QUERY,
    LIST_STREAMS_QUERY,
} from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult } from "./shared";
type StreamNode = {
    id: string;
    host: string;
    port: number;
    path: string;
    isTls: boolean;
    direction: string;
    source: string;
    protocol: string;
    createdAt: string;
};

type StreamEdge = {
    cursor: string;
    node: StreamNode;
};

type StreamConnection = {
    pageInfo?: {
        hasPreviousPage: boolean;
        hasNextPage: boolean;
        startCursor?: string;
        endCursor?: string;
    };
    edges?: StreamEdge[];
    nodes?: StreamNode[];
    snapshot?: string;
    count?: { value: number };
};

type StreamResponse = {
    stream?: StreamNode;
};

type StreamsResponse = {
    streams?: StreamConnection;
};

type StreamsByOffsetResponse = {
    streamsByOffset?: StreamConnection;
};

type StreamWsMessageEditNode = {
    id: string;
    alteration: string;
    direction: string;
    format: string;
    length: number;
    createdAt: string;
    raw?: string;
};

type StreamWsMessageNode = {
    id: string;
    stream?: { id: string };
    edits?: Array<{ id: string; alteration: string }>;
    head?: StreamWsMessageEditNode;
};

type StreamWsMessageEdge = {
    cursor: string;
    node: StreamWsMessageNode;
};

type StreamWsMessageConnection = {
    pageInfo?: {
        hasPreviousPage: boolean;
        hasNextPage: boolean;
        startCursor?: string;
        endCursor?: string;
    };
    edges?: StreamWsMessageEdge[];
    nodes?: StreamWsMessageNode[];
    snapshot?: string;
    count?: { value: number };
};

type StreamWsMessageResponse = {
    streamWsMessage?: StreamWsMessageNode;
};

type StreamWsMessagesResponse = {
    streamWsMessages?: StreamWsMessageConnection;
};

type StreamWsMessagesByOffsetResponse = {
    streamWsMessagesByOffset?: StreamWsMessageConnection;
};

type StreamWsMessageEditResponse = {
    streamWsMessageEdit?: StreamWsMessageEditNode;
};

type RawOptions = {
    includeRaw?: boolean;
    maxRawBytes?: number;
};

type SerializedWsMessageEdit = {
    id: string;
    alteration: string;
    direction: string;
    format: string;
    length: number;
    createdAt: string;
    raw: string | undefined;
    rawUtf8?: string;
    rawBase64?: string;
    rawEncoding?: "base64" | "omitted";
};

type SerializedWsMessage = {
    id: string;
    streamId?: string;
    head?: SerializedWsMessageEdit;
    edits?: Array<{ id: string; alteration: string }>;
};

const DEFAULT_MAX_RAW_BYTES = 256;
const formatBinaryPlaceholder = (size: number) => `<...binary data ${size} bytes...>`;

const normalizeRawOptions = (options?: RawOptions) => ({
    includeRaw: options?.includeRaw !== false,
    maxRawBytes:
        options?.maxRawBytes !== undefined
            ? Math.max(0, options.maxRawBytes)
            : DEFAULT_MAX_RAW_BYTES,
});

const serializeWsMessageEdit = (
    edit?: StreamWsMessageEditNode,
    options?: RawOptions,
): SerializedWsMessageEdit | undefined => {
    if (edit === undefined) return undefined;
    const { includeRaw, maxRawBytes } = normalizeRawOptions(options);
    const size = edit.length;
    if (!includeRaw || size > maxRawBytes) {
        return {
            id: edit.id,
            alteration: edit.alteration,
            direction: edit.direction,
            format: edit.format,
            length: edit.length,
            createdAt: edit.createdAt,
            raw: formatBinaryPlaceholder(size),
            rawUtf8: formatBinaryPlaceholder(size),
            rawBase64: formatBinaryPlaceholder(size),
            rawEncoding: "omitted",
        };
    }
    const rawBase64 = edit.raw ?? undefined;
    const rawUtf8 =
        rawBase64 !== undefined ? Buffer.from(rawBase64, "base64").toString("utf8") : undefined;
    return {
        id: edit.id,
        alteration: edit.alteration,
        direction: edit.direction,
        format: edit.format,
        length: edit.length,
        createdAt: edit.createdAt,
        raw: rawBase64,
        rawUtf8,
        rawBase64,
        rawEncoding: "base64",
    };
};

const serializeWsMessage = (
    message: StreamWsMessageNode,
    options?: RawOptions,
): SerializedWsMessage => ({
    id: message.id,
    streamId: message.stream?.id ?? undefined,
    head: serializeWsMessageEdit(message.head, options),
    edits: message.edits ?? [],
});

const serializeWsMessageConnection = (
    connection?: StreamWsMessageConnection,
    options?: RawOptions,
) => {
    if (connection === undefined) return undefined;
    return {
        pageInfo: connection.pageInfo ?? undefined,
        snapshot: connection.snapshot ?? undefined,
        count: connection.count ?? undefined,
        edges: (connection.edges ?? []).map((edge) => ({
            cursor: edge.cursor,
            node: serializeWsMessage(edge.node, options),
        })),
        nodes: (connection.nodes ?? []).map((node) => serializeWsMessage(node, options)),
    };
};

const buildOrderInput = (input?: { by?: "ID"; ordering?: "ASC" | "DESC" }) => ({
    by: input?.by ?? "ID",
    ordering: input?.ordering ?? "DESC",
});

export const registerWebsocketTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const idSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const orderSchema = z
        .object({
            by: z.enum(["ID"]).optional(),
            ordering: z.enum(["ASC", "DESC"]).optional(),
        })
        .strict();
    type OrderInput = z.infer<typeof orderSchema>;
    const protocolSchema = z.preprocess(
        (value) => (value === null || value === "" ? undefined : value),
        z.enum(["WS", "SSE"]).default("WS"),
    );
    const directionSchema = z.preprocess(
        (value) => (value === null || value === "" ? undefined : value),
        z.enum(["BOTH", "CLIENT", "SERVER"]).optional(),
    );
    const paginationSchema = z
        .object({
            first: z.number().int().min(1).max(500).optional(),
            after: z.string().min(1).optional(),
            last: z.number().int().min(1).max(500).optional(),
            before: z.string().min(1).optional(),
        })
        .strict();
    const offsetSchema = z
        .object({
            offset: z.number().int().min(0).optional(),
            limit: z.number().int().min(1).max(500).optional(),
        })
        .strict();
    const rawOptionsSchema = z
        .object({
            includeRaw: z.boolean().optional(),
            maxRawBytes: z.number().int().min(0).optional(),
        })
        .strict();
    type RawOptionsInput = z.infer<typeof rawOptionsSchema>;
    const streamIdSchema = z.preprocess(
        (value) => (value === null || value === "" ? undefined : value),
        idSchema.optional(),
    );
    const getStreamSchema = z.object({ ids: z.array(idSchema).min(1) }).strict();
    const getMessageSchema = z
        .object({
            ids: z.array(idSchema).min(1),
            rawOptions: rawOptionsSchema.optional(),
        })
        .strict();

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.listStreams",
        group: ToolGroupId.WsSafe,
        toolName: "list-websocket-streams",
        description:
            "List WebSocket/SSE streams (cursor pagination). " +
            "Use first/after or last/before; feed pageInfo.* back as after/before. " +
            'Example: { "first": 50, "protocol": "WS" }.',
        inputSchema: paginationSchema
            .extend({
                protocol: protocolSchema,
                scopeId: streamIdSchema,
                order: orderSchema.optional(),
            })
            .strict(),
        handler: async (params) => {
            const orderInput = params.order as OrderInput | undefined;
            const order = orderInput ? buildOrderInput(orderInput) : undefined;
            const variables: Record<string, unknown> = {
                first: params.first,
                after: params.after,
                last: params.last,
                before: params.before,
                order,
            };
            variables.protocol = params.protocol ?? "WS";
            if (params.scopeId !== undefined && params.scopeId !== null) {
                variables.scopeId = params.scopeId;
            }
            const response = await sdk.graphql.execute<StreamsResponse>(
                LIST_STREAMS_QUERY,
                variables,
            );
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.listStreamsByOffset",
        group: ToolGroupId.WsSafe,
        toolName: "list-websocket-streams-by-offset",
        description:
            "List WebSocket/SSE streams (offset/limit pagination). " +
            'Example: { "offset": 0, "limit": 200, "protocol": "WS" }.',
        inputSchema: offsetSchema
            .extend({
                protocol: protocolSchema,
                scopeId: streamIdSchema,
                order: orderSchema.optional(),
            })
            .strict(),
        handler: async (params) => {
            const variables: Record<string, unknown> = {
                offset: params.offset ?? 0,
                limit: params.limit ?? 200,
                order: buildOrderInput(params.order as OrderInput | undefined),
            };
            variables.protocol = params.protocol ?? "WS";
            if (params.scopeId !== undefined && params.scopeId !== null) {
                variables.scopeId = params.scopeId;
            }
            const response = await sdk.graphql.execute<StreamsByOffsetResponse>(
                LIST_STREAMS_BY_OFFSET_QUERY,
                variables,
            );
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.getStream",
        group: ToolGroupId.WsSafe,
        toolName: "get-websocket-stream",
        description: 'Get WebSocket/SSE streams by ID. Example: { "ids": [1] }.',
        inputSchema: getStreamSchema,
        handler: async (params) => {
            const { ids } = getStreamSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute<StreamResponse>(GET_STREAM_QUERY, {
                        id,
                    });
                    return { id, result: response.data ?? response };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.listMessages",
        group: ToolGroupId.WsSafe,
        toolName: "list-websocket-messages",
        description:
            "List WebSocket messages for a stream (cursor pagination). " +
            "Use first/after or last/before; feed pageInfo.* back as after/before. " +
            "rawOptions: { includeRaw?, maxRawBytes? } (defaults: includeRaw=true, maxRawBytes=256). " +
            'Example: { "streamId": 1, "first": 100 }.',
        inputSchema: paginationSchema
            .extend({
                streamId: streamIdSchema,
                order: orderSchema.optional(),
                rawOptions: rawOptionsSchema.optional(),
            })
            .strict()
            .refine((value) => value.streamId !== undefined, "streamId is required"),
        handler: async (params) => {
            const orderInput = params.order as OrderInput | undefined;
            const rawOptions = params.rawOptions as RawOptionsInput | undefined;
            const response = await sdk.graphql.execute<StreamWsMessagesResponse>(
                LIST_STREAM_WS_MESSAGES_QUERY,
                {
                    streamId: params.streamId,
                    first: params.first,
                    after: params.after,
                    last: params.last,
                    before: params.before,
                    order: buildOrderInput(orderInput),
                },
            );
            const connection = serializeWsMessageConnection(
                response.data?.streamWsMessages,
                rawOptions,
            );
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult(connection ?? response.data ?? response),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.listMessagesByOffset",
        group: ToolGroupId.WsSafe,
        toolName: "list-websocket-messages-by-offset",
        description:
            "List WebSocket messages for a stream (offset/limit pagination). " +
            "rawOptions: { includeRaw?, maxRawBytes? } (defaults: includeRaw=true, maxRawBytes=256). " +
            'Example: { "streamId": 1, "offset": 0, "limit": 200 }.',
        inputSchema: offsetSchema
            .extend({
                streamId: streamIdSchema,
                order: orderSchema.optional(),
                rawOptions: rawOptionsSchema.optional(),
            })
            .strict()
            .refine((value) => value.streamId !== undefined, "streamId is required"),
        handler: async (params) => {
            const orderInput = params.order as OrderInput | undefined;
            const rawOptions = params.rawOptions as RawOptionsInput | undefined;
            const response = await sdk.graphql.execute<StreamWsMessagesByOffsetResponse>(
                LIST_STREAM_WS_MESSAGES_BY_OFFSET_QUERY,
                {
                    streamId: params.streamId,
                    offset: params.offset ?? 0,
                    limit: params.limit ?? 200,
                    order: buildOrderInput(orderInput),
                },
            );
            const connection = serializeWsMessageConnection(
                response.data?.streamWsMessagesByOffset,
                rawOptions,
            );
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult(connection ?? response.data ?? response),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.getMessage",
        group: ToolGroupId.WsSafe,
        toolName: "get-websocket-message",
        description:
            "Get WebSocket messages by ID. " +
            "rawOptions: { includeRaw?, maxRawBytes? } (defaults: includeRaw=true, maxRawBytes=256). " +
            'Example: { "ids": [123] }.',
        inputSchema: getMessageSchema,
        handler: async (params) => {
            const rawOptions = params.rawOptions as RawOptionsInput | undefined;
            const { ids } = getMessageSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute<StreamWsMessageResponse>(
                        GET_STREAM_WS_MESSAGE_QUERY,
                        { id },
                    );
                    const message = response.data?.streamWsMessage;
                    const serialized =
                        message !== undefined ? serializeWsMessage(message, rawOptions) : undefined;
                    return { id, result: serialized ?? response.data ?? response };
                }),
            );
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
        action: "sdk.websocket.getMessageEdit",
        group: ToolGroupId.WsSafe,
        toolName: "get-websocket-message-edit",
        description:
            "Get specific message edits by edit ID (not the message ID). " +
            "rawOptions: { includeRaw?, maxRawBytes? } (defaults: includeRaw=true, maxRawBytes=256). " +
            'Example: { "ids": [123] }.',
        inputSchema: getMessageSchema,
        handler: async (params) => {
            const rawOptions = params.rawOptions as RawOptionsInput | undefined;
            const { ids } = getMessageSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute<StreamWsMessageEditResponse>(
                        GET_STREAM_WS_MESSAGE_EDIT_QUERY,
                        { id },
                    );
                    const edit = response.data?.streamWsMessageEdit;
                    const serialized =
                        edit !== undefined ? serializeWsMessageEdit(edit, rawOptions) : undefined;
                    return { id, result: serialized ?? response.data ?? response };
                }),
            );
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
        action: "sdk.websocket.streamsByDirection",
        group: ToolGroupId.WsSafe,
        toolName: "list-websocket-streams-by-direction",
        description:
            "List WebSocket/SSE streams filtered by direction (CLIENT|SERVER|BOTH). " +
            'Example: { "direction": "CLIENT", "protocol": "WS" }.',
        inputSchema: z
            .object({
                direction: directionSchema,
                protocol: protocolSchema.optional(),
                limit: z.number().int().min(1).max(500).optional(),
            })
            .strict()
            .refine((value) => value.direction !== undefined, "direction is required"),
        handler: async (params) => {
            const response = await sdk.graphql.execute<StreamsByOffsetResponse>(
                LIST_STREAMS_BY_OFFSET_QUERY,
                {
                    offset: 0,
                    limit: params.limit ?? 200,
                    protocol: params.protocol,
                    order: { by: "ID", ordering: "DESC" },
                },
            );
            const streams = response.data?.streamsByOffset?.nodes ?? [];
            const filtered = streams.filter((stream) => stream.direction === params.direction);
            return { content: [{ type: "text", text: stringifyResult(filtered) }] };
        },
    });
};
