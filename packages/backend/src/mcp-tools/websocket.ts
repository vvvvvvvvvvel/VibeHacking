import { Buffer } from "buffer";

import { z } from "zod";

import {
    GET_STREAM_QUERY,
    GET_STREAM_WS_MESSAGE_EDIT_QUERY,
    GET_STREAM_WS_MESSAGE_QUERY,
    LIST_STREAM_WS_MESSAGES_QUERY,
    LIST_STREAMS_QUERY,
} from "../graphql";
import {
    applyProjectionToLookupResults,
    applyProjectionToResults,
    DEFAULT_MAX_BINARY_BODY_BYTES,
    DEFAULT_MAX_TEXT_PAYLOAD_CHARS,
    normalizeWebSocketSerialization,
    resolveFieldProjection,
    serializeBytes,
    WS_MESSAGE_FIELD_PATHS,
} from "../history";
import type {
    FieldProjection,
    SerializedWebSocketMessage,
    WebSocketSerializationOptions,
    WebSocketSerializationOptionsInput,
} from "../history";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult, toNumericId } from "./shared";

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

type StreamConnection = {
    pageInfo?: {
        hasPreviousPage: boolean;
        hasNextPage: boolean;
        startCursor?: string;
        endCursor?: string;
    };
    edges?: Array<{ cursor: string; node: StreamNode }>;
    count?: { value?: number };
    snapshot?: string;
};

type StreamsResponse = {
    streams?: StreamConnection;
};

type StreamResponse = {
    stream?: StreamNode;
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
    stream?: StreamNode;
    edits?: Array<{ id: string; alteration: string }>;
    head?: StreamWsMessageEditNode;
};

type StreamWsMessageConnection = {
    pageInfo?: {
        hasPreviousPage: boolean;
        hasNextPage: boolean;
        startCursor?: string;
        endCursor?: string;
    };
    edges?: Array<{ cursor: string; node: StreamWsMessageNode }>;
    count?: { value?: number };
    snapshot?: string;
};

type StreamWsMessagesResponse = {
    streamWsMessages?: StreamWsMessageConnection;
};

type StreamWsMessageResponse = {
    streamWsMessage?: StreamWsMessageNode;
};

type StreamWsMessageEditResponse = {
    streamWsMessageEdit?: StreamWsMessageEditNode;
};

type ListWsMessagesInput = {
    stream_id?: string;
    cursor?: string;
    direction?: "after" | "before";
    order?: { by?: "ID"; ordering?: "ASC" | "DESC" };
    limit?: number;
    serialization?: WebSocketSerializationOptionsInput;
    fields?: string[];
    exclude_fields?: string[];
};

const idSchema = z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().min(1),
);

const idArraySchema = z.array(idSchema).min(1);

const wsOrderSchema = z
    .object({
        by: z.enum(["ID"]).default("ID"),
        ordering: z.enum(["ASC", "DESC"]).default("DESC"),
    })
    .strict()
    .default({ by: "ID", ordering: "DESC" });

const cursorPaginationSchema = z.object({
    limit: z.number().int().min(1).max(500).default(50),
    cursor: z.string().min(1).optional(),
    direction: z.enum(["after", "before"]).default("after"),
});

const defaultWebSocketSerialization = {
    include_binary: false,
    include_edited_payload: false,
    max_text_payload_chars: DEFAULT_MAX_TEXT_PAYLOAD_CHARS,
    max_binary_payload_bytes: DEFAULT_MAX_BINARY_BODY_BYTES,
} satisfies WebSocketSerializationOptionsInput;

const websocketSerializationSchema = z
    .object({
        include_binary: z.boolean().default(defaultWebSocketSerialization.include_binary),
        include_edited_payload: z
            .boolean()
            .default(defaultWebSocketSerialization.include_edited_payload),
        max_text_payload_chars: z
            .number()
            .int()
            .min(0)
            .default(defaultWebSocketSerialization.max_text_payload_chars),
        max_binary_payload_bytes: z
            .number()
            .int()
            .min(0)
            .default(defaultWebSocketSerialization.max_binary_payload_bytes),
    })
    .strict()
    .default(defaultWebSocketSerialization);

const listStreamsSchema = z
    .object({
        ...cursorPaginationSchema.shape,
        protocol: z.enum(["WS", "SSE"]).default("WS"),
        scope_id: idSchema.nullable().default(null),
        order: wsOrderSchema,
    })
    .strict();

const getStreamsSchema = z.object({ ids: idArraySchema }).strict();

const listMessagesSchema = z
    .object({
        ...cursorPaginationSchema.shape,
        stream_id: idSchema,
        order: wsOrderSchema,
        serialization: websocketSerializationSchema,
        fields: z
            .array(z.string().min(1))
            .nullable()
            .default(null)
            .transform((value) => value ?? undefined),
        exclude_fields: z
            .array(z.string().min(1))
            .nullable()
            .default(null)
            .transform((value) => value ?? undefined),
    })
    .strict();

const getMessagesSchema = z
    .object({
        ids: idArraySchema,
        serialization: websocketSerializationSchema,
        fields: z
            .array(z.string().min(1))
            .nullable()
            .default(null)
            .transform((value) => value ?? undefined),
        exclude_fields: z
            .array(z.string().min(1))
            .nullable()
            .default(null)
            .transform((value) => value ?? undefined),
    })
    .strict();

const getMessageEditsSchema = z
    .object({
        ids: idArraySchema,
        serialization: websocketSerializationSchema,
    })
    .strict();

const messageTime = (message: StreamWsMessageNode) => message.head?.createdAt ?? "";

const decodePayload = (raw?: string) =>
    raw !== undefined && raw !== "" ? Buffer.from(raw, "base64") : Buffer.alloc(0);

const serializeEditPayload = (
    edit: StreamWsMessageEditNode | undefined,
    options: WebSocketSerializationOptions,
) =>
    serializeBytes({
        bytes: decodePayload(edit?.raw),
        includeBinary: options.includeBinary,
        maxTextChars: options.maxTextPayloadChars,
        maxBinaryBytes: options.maxBinaryPayloadBytes,
    });

const normalizeStream = (stream?: StreamNode) =>
    stream === undefined || stream === null
        ? undefined
        : {
              id: toNumericId(stream.id),
              host: stream.host,
              port: stream.port,
              path: stream.path,
              secure: stream.isTls,
              direction: stream.direction,
              source: stream.source,
              protocol: stream.protocol,
              createdAt: stream.createdAt,
          };

const serializeMessage = (
    message: StreamWsMessageNode,
    options: WebSocketSerializationOptions,
): SerializedWebSocketMessage => {
    const editedPayload = options.includeEditedPayload
        ? serializeEditPayload(message.head, options)
        : undefined;
    const result: SerializedWebSocketMessage = {
        id: toNumericId(message.id),
        streamId: message.stream?.id !== undefined ? toNumericId(message.stream.id) : undefined,
        headId: message.head?.id !== undefined ? toNumericId(message.head.id) : undefined,
        editIds: (message.edits ?? []).map((edit) => toNumericId(edit.id)),
        time: messageTime(message),
        direction: message.head?.direction ?? "",
        alteration: message.head?.alteration,
        format: message.head?.format,
        length: message.head?.length ?? 0,
        payload: serializeEditPayload(message.head, options),
        editedPayload,
        stream: normalizeStream(message.stream),
    };
    return result;
};

const cursorVariables = (input: { limit?: number; cursor?: string; direction?: string }) => {
    const limit = Math.max(1, Math.min(500, input.limit ?? 50));
    if (input.direction === "before") {
        return { last: limit, before: input.cursor };
    }
    return { first: limit, after: input.cursor };
};

const pageInfo = (connection?: { pageInfo?: StreamConnection["pageInfo"] }) => ({
    hasNextPage: connection?.pageInfo?.hasNextPage ?? false,
    hasPreviousPage: connection?.pageInfo?.hasPreviousPage ?? false,
    startCursor: connection?.pageInfo?.startCursor ?? null,
    endCursor: connection?.pageInfo?.endCursor ?? null,
});

const queryWebSocketStreams = async (
    sdk: ToolContext["sdk"],
    input: z.infer<typeof listStreamsSchema>,
) => {
    const response = await sdk.graphql.execute<StreamsResponse>(LIST_STREAMS_QUERY, {
        ...cursorVariables(input),
        protocol: input.protocol,
        scopeId: input.scope_id ?? undefined,
        order: input.order,
    });
    if (response.errors !== undefined && response.errors.length > 0) {
        throw new Error(JSON.stringify(response.errors));
    }
    const connection = response.data?.streams;
    const edges = connection?.edges ?? [];
    return {
        pageInfo: pageInfo(connection),
        snapshot: connection?.snapshot,
        count: connection?.count,
        items: edges
            .map((edge) => {
                const stream = normalizeStream(edge.node);
                return stream === undefined ? null : { cursor: edge.cursor, ...stream };
            })
            .filter((item) => item !== null),
    };
};

const queryWebSocketMessages = async (
    sdk: ToolContext["sdk"],
    input: ListWsMessagesInput,
    projection: FieldProjection | undefined,
) => {
    const options = normalizeWebSocketSerialization(input.serialization);
    const response = await sdk.graphql.execute<StreamWsMessagesResponse>(
        LIST_STREAM_WS_MESSAGES_QUERY,
        {
            streamId: input.stream_id,
            ...cursorVariables(input),
            order: input.order,
        },
    );
    if (response.errors !== undefined && response.errors.length > 0) {
        throw new Error(JSON.stringify(response.errors));
    }
    const connection = response.data?.streamWsMessages;
    const edges = connection?.edges ?? [];
    const items = [];
    for (const edge of edges) {
        items.push({
            cursor: edge.cursor,
            ...serializeMessage(edge.node, options),
        });
    }
    return {
        pageInfo: pageInfo(connection),
        snapshot: connection?.snapshot,
        count: connection?.count,
        items: applyProjectionToResults(items, projection),
    };
};

export const registerWebsocketTools = ({ server, sdk, store, permissions }: ToolContext) => {
    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.listStreams",
        group: ToolGroupId.WsSafe,
        toolName: "list_websocket_streams",
        description:
            "List WebSocket/SSE streams with native cursor pagination. " +
            'Example: { "limit": 50, "protocol": "WS" }.',
        inputSchema: listStreamsSchema,
        handler: async (params) => {
            const input = listStreamsSchema.parse(params);
            const result = await queryWebSocketStreams(sdk, input);
            return { content: [{ type: "text", text: stringifyResult(result) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.getStreamsByIds",
        group: ToolGroupId.WsSafe,
        toolName: "get_websocket_streams_by_ids",
        description: 'Fetch exact WebSocket/SSE streams by ID. Example: { "ids": [1] }.',
        inputSchema: getStreamsSchema,
        handler: async (params) => {
            const { ids } = getStreamsSchema.parse(params);
            const results = [];
            for (const id of ids) {
                const response = await sdk.graphql.execute<StreamResponse>(GET_STREAM_QUERY, {
                    id,
                });
                const stream = normalizeStream(response.data?.stream);
                if (stream === undefined) {
                    results.push({ id, error: "not found" });
                } else {
                    results.push({ id, item: stream });
                }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            requested: ids.length,
                            found: results.filter((item) => "item" in item).length,
                            results,
                        }),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.listMessages",
        group: ToolGroupId.WsSafe,
        toolName: "list_websocket_messages",
        description:
            "List WebSocket/SSE messages for one stream with native cursor pagination, serialization, and projection. " +
            'Example: { "stream_id": 1, "limit": 50, "fields": ["cursor", "id", "direction", "payload.text"] }.',
        inputSchema: listMessagesSchema,
        handler: async (params) => {
            const input = listMessagesSchema.parse(params) as ListWsMessagesInput;
            const projection = resolveFieldProjection({
                fields: input.fields,
                excludeFields: input.exclude_fields,
                allowedPaths: WS_MESSAGE_FIELD_PATHS,
            });
            const result = await queryWebSocketMessages(sdk, input, projection);
            return { content: [{ type: "text", text: stringifyResult(result) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.getMessagesByIds",
        group: ToolGroupId.WsSafe,
        toolName: "get_websocket_messages_by_ids",
        description:
            "Fetch exact WebSocket/SSE messages by message ID with projection. " +
            'Example: { "ids": [1], "fields": ["id", "payload.text"] }.',
        inputSchema: getMessagesSchema,
        handler: async (params) => {
            const input = getMessagesSchema.parse(params);
            const projection = resolveFieldProjection({
                fields: input.fields,
                excludeFields: input.exclude_fields,
                allowedPaths: WS_MESSAGE_FIELD_PATHS,
            });
            const options = normalizeWebSocketSerialization(input.serialization);
            const results = [];
            for (const id of input.ids) {
                const response = await sdk.graphql.execute<StreamWsMessageResponse>(
                    GET_STREAM_WS_MESSAGE_QUERY,
                    { id },
                );
                const message = response.data?.streamWsMessage;
                if (message === undefined || message === null) {
                    results.push({ id, error: "not found" });
                    continue;
                }
                results.push({ id, item: serializeMessage(message, options) });
            }
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            requested: input.ids.length,
                            found: results.filter((item) => "item" in item).length,
                            results: applyProjectionToLookupResults(results, projection),
                        }),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.websocket.getMessageEditsByIds",
        group: ToolGroupId.WsSafe,
        toolName: "get_websocket_message_edits_by_ids",
        description:
            "Fetch exact WebSocket/SSE message edits by edit ID. " +
            'Example: { "ids": [1], "serialization": { "include_binary": false } }.',
        inputSchema: getMessageEditsSchema,
        handler: async (params) => {
            const input = getMessageEditsSchema.parse(params);
            const options = normalizeWebSocketSerialization(input.serialization);
            const results = [];
            for (const id of input.ids) {
                const response = await sdk.graphql.execute<StreamWsMessageEditResponse>(
                    GET_STREAM_WS_MESSAGE_EDIT_QUERY,
                    { id },
                );
                const edit = response.data?.streamWsMessageEdit;
                if (edit === undefined || edit === null) {
                    results.push({ id, error: "not found" });
                    continue;
                }
                results.push({
                    id,
                    item: {
                        id: toNumericId(edit.id),
                        alteration: edit.alteration,
                        direction: edit.direction,
                        format: edit.format,
                        length: edit.length,
                        createdAt: edit.createdAt,
                        payload: serializeEditPayload(edit, options),
                    },
                });
            }
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            requested: input.ids.length,
                            found: results.filter((item) => "item" in item).length,
                            results,
                        }),
                    },
                ],
            };
        },
    });
};
