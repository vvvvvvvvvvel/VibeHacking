/* eslint-disable @typescript-eslint/no-restricted-types */
import { z } from "zod";

import {
    GET_AUTOMATE_ENTRY_QUERY,
    GET_AUTOMATE_SESSION_QUERY,
    LIST_AUTOMATE_ENTRY_REQUESTS_QUERY,
    LIST_AUTOMATE_SESSIONS_QUERY,
} from "../graphql";
import {
    applyProjectionToResults,
    buildHttpMatchContext,
    HTTP_HISTORY_FIELD_PATHS,
    normalizeHttpSerialization,
    normalizeRegexExcerptProjection,
    resolveFieldProjection,
    resolveHttpBodyMaterialization,
    resolveRegexExcerpt,
    serializeHttpHistoryEntry,
} from "../history";
import type {
    HttpSerializationOptions,
    ProjectedHttpSerializationOptionsInput,
    RegexExcerptConfig,
} from "../history";
import { ToolGroupId } from "../tool-permissions";

import { listHttpSerializationSchema } from "./http-serialization-schema";
import { registerToolAction, type ToolContext } from "./register";
import {
    ciEnumDefault,
    HTTPQL_HELP_SHORT,
    stringifyResult,
    toId,
    validateHttpqlClause,
} from "./shared";

type PageInfo = {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor?: string | null;
    endCursor?: string | null;
};

type AutomateConnection = {
    host: string;
    port: number;
    isTLS: boolean;
    SNI?: string | null;
};

type AutomateEntrySummary = {
    id: string;
    name: string;
    createdAt: string;
    connection?: AutomateConnection;
};

type AutomateSession = {
    id: string;
    name: string;
    createdAt: string;
    raw?: string;
    connection: AutomateConnection;
    settings?: unknown;
    entries?: AutomateEntrySummary[];
};

type AutomateSessionsResponse = {
    automateSessions: {
        pageInfo: PageInfo;
        count: { value: number };
        snapshot: number;
        nodes: AutomateSession[];
    };
};

type AutomateSessionResponse = {
    automateSession?: AutomateSession | null;
};

type AutomateEntryResponse = {
    automateEntry?:
        | (AutomateEntrySummary & {
              raw?: string;
              settings?: unknown;
              session: { id: string; name: string };
              requests: { count: { value: number }; snapshot: number };
          })
        | null;
};

type AutomateRequestNode = {
    sequenceId: string;
    automateEntryId: string;
    error?: string | null;
    payloads: Array<{ raw?: string | null; position?: number | null }>;
    extracts: Array<{ name: string; raw?: string }>;
    request: { id: string };
};

type AutomateEntryRequestsResponse = {
    automateEntry?: {
        id: string;
        name: string;
        requests: {
            pageInfo: PageInfo;
            count: { value: number };
            snapshot: number;
            edges: Array<{ cursor: string; node: AutomateRequestNode }>;
        };
    } | null;
};

type ListAutomateEntryRequestsInput = {
    entry_id: string;
    filter?: string;
    limit: number;
    cursor?: string;
    direction: "after" | "before";
    order: { by: string; direction: "asc" | "desc" };
    serialization?: ProjectedHttpSerializationOptionsInput;
    fields?: string[];
    exclude_fields?: string[];
};

const idSchema = z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().min(1),
);

const nullableFieldList = z
    .array(z.string().min(1))
    .nullable()
    .default(null)
    .transform((value) => value ?? undefined);

const paginationSchema = z
    .object({
        limit: z.number().int().min(1).max(500).default(50),
        cursor: z.string().min(1).optional(),
        direction: ciEnumDefault(["after", "before"], "after"),
    })
    .strict();

const listAutomateSessionsSchema = paginationSchema;

const getAutomateItemSchema = z
    .object({
        id: idSchema,
        include_raw: z.boolean().default(false),
        include_payload_values: z.boolean().default(false),
    })
    .strict();

const automateRequestOrderFields = [
    "ID",
    "PAYLOAD_0",
    "PAYLOAD_1",
    "PAYLOAD_2",
    "PAYLOAD_3",
    "PAYLOAD_4",
    "POSITION",
    "EXTRACT_0",
    "EXTRACT_1",
    "EXTRACT_2",
    "EXTRACT_3",
    "EXTRACT_4",
    "RESP_LENGTH",
    "RESP_ROUNDTRIP_TIME",
    "RESP_STATUS_CODE",
    "REQ_CREATED_AT",
] as const;

const listAutomateEntryRequestsSchema = z
    .object({
        entry_id: idSchema,
        filter: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(500).default(50),
        cursor: z.string().min(1).optional(),
        direction: ciEnumDefault(["after", "before"], "after"),
        order: z
            .object({
                by: ciEnumDefault(automateRequestOrderFields, "POSITION"),
                direction: ciEnumDefault(["asc", "desc"], "asc"),
            })
            .strict()
            .default({ by: "POSITION", direction: "asc" }),
        serialization: listHttpSerializationSchema,
        fields: nullableFieldList,
        exclude_fields: nullableFieldList,
    })
    .strict();

const AUTOMATE_REQUEST_FIELD_PATHS = new Set([
    ...HTTP_HISTORY_FIELD_PATHS,
    "sequence_id",
    "automate_entry_id",
    "automate_error",
    "payloads",
    "payloads.raw",
    "payloads.position",
    "extracts",
    "extracts.name",
    "extracts.raw",
    "request_error",
]);

const shouldIncludeAutomateValues = (projection: ReturnType<typeof resolveFieldProjection>) => {
    if (projection?.fields !== undefined) {
        return Array.from(projection.fields).some(
            (path) =>
                path === "payloads" ||
                path === "payloads.raw" ||
                path === "extracts" ||
                path === "extracts.raw",
        );
    }
    if (projection?.excludeFields !== undefined) {
        const excluded = projection.excludeFields;
        const includesPayloadRaw = !excluded.has("payloads") && !excluded.has("payloads.raw");
        const includesExtractRaw = !excluded.has("extracts") && !excluded.has("extracts.raw");
        return includesPayloadRaw || includesExtractRaw;
    }
    return false;
};

const paginationVariables = (input: {
    limit: number;
    cursor?: string;
    direction: "after" | "before";
}) =>
    input.direction === "before"
        ? { last: input.limit, before: input.cursor }
        : { first: input.limit, after: input.cursor };

const serializeAutomateRequest = async ({
    sdk,
    node,
    cursor,
    serialization,
    regexExcerpt,
}: {
    sdk: ToolContext["sdk"];
    node: AutomateRequestNode;
    cursor: string;
    serialization: HttpSerializationOptions;
    regexExcerpt: RegexExcerptConfig | undefined;
}) => {
    const pair = await sdk.requests.get(toId(node.request.id));
    const metadata = {
        cursor,
        sequenceId: node.sequenceId,
        automateEntryId: node.automateEntryId,
        automateError: node.error ?? undefined,
        payloads: node.payloads,
        extracts: node.extracts,
    };
    if (pair?.request === undefined) {
        return {
            ...metadata,
            id: node.request.id,
            requestError: "saved request not found",
        };
    }
    const history = serializeHttpHistoryEntry({
        pair,
        options: serialization,
        matchContext: buildHttpMatchContext(pair, regexExcerpt),
        inScope: sdk.requests.inScope(pair.request),
    });
    return history === undefined ? metadata : { ...metadata, ...history };
};

export const registerAutomateTools = ({
    server,
    sdk,
    graphql,
    store,
    permissions,
}: ToolContext) => {
    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.automate.listSessions",
        group: ToolGroupId.AutomateSafe,
        toolName: "list_automate_sessions",
        description: "List Automate sessions with native cursor pagination.",
        inputSchema: listAutomateSessionsSchema,
        handler: async (params) => {
            const input = listAutomateSessionsSchema.parse(params);
            const response = await graphql.execute<AutomateSessionsResponse>(
                LIST_AUTOMATE_SESSIONS_QUERY,
                paginationVariables(input),
            );
            const page = response.data?.automateSessions;
            if (page === undefined) throw new Error("Caido did not return Automate sessions");
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            pageInfo: page.pageInfo,
                            snapshot: page.snapshot,
                            count: page.count.value,
                            items: page.nodes,
                        }),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.automate.getSession",
        group: ToolGroupId.AutomateSafe,
        toolName: "get_automate_session",
        description:
            "Get an Automate session, including its settings and entry summaries. Raw request data and full simple-list payload values are omitted unless include_raw or include_payload_values is true.",
        inputSchema: getAutomateItemSchema,
        handler: async (params) => {
            const input = getAutomateItemSchema.parse(params);
            const response = await graphql.execute<AutomateSessionResponse>(
                GET_AUTOMATE_SESSION_QUERY,
                {
                    id: input.id,
                    includeRaw: input.include_raw,
                    includePayloadValues: input.include_payload_values,
                },
            );
            const session = response.data?.automateSession;
            if (session === undefined || session === null) {
                throw new Error(`Automate session not found: ${input.id}`);
            }
            return { content: [{ type: "text", text: stringifyResult(session) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.automate.getEntry",
        group: ToolGroupId.AutomateSafe,
        toolName: "get_automate_entry",
        description:
            "Get an Automate entry with its settings, session, and request count. Raw request data and full simple-list payload values are omitted unless include_raw or include_payload_values is true.",
        inputSchema: getAutomateItemSchema,
        handler: async (params) => {
            const input = getAutomateItemSchema.parse(params);
            const response = await graphql.execute<AutomateEntryResponse>(
                GET_AUTOMATE_ENTRY_QUERY,
                {
                    id: input.id,
                    includeRaw: input.include_raw,
                    includePayloadValues: input.include_payload_values,
                },
            );
            const entry = response.data?.automateEntry;
            if (entry === undefined || entry === null) {
                throw new Error(`Automate entry not found: ${input.id}`);
            }
            return { content: [{ type: "text", text: stringifyResult(entry) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.automate.listEntryRequests",
        group: ToolGroupId.AutomateSafe,
        toolName: "list_automate_entry_requests",
        description:
            "List the requests generated by an Automate entry with native cursor pagination, HTTPQL filtering, order, payload/extract metadata, HTTP serialization controls, regex_excerpt, and fields/exclude_fields projection.\n\n" +
            "Raw payload and extract values are materialized only when fields explicitly selects payloads, payloads.raw, extracts, or extracts.raw; exclude_fields retains full-shape behavior.\n\n" +
            HTTPQL_HELP_SHORT,
        inputSchema: listAutomateEntryRequestsSchema,
        handler: async (params) => {
            const input = listAutomateEntryRequestsSchema.parse(
                params,
            ) as ListAutomateEntryRequestsInput;
            if (input.filter !== undefined) {
                const validationError = await validateHttpqlClause(sdk, input.filter);
                if (validationError !== null) throw new Error(JSON.stringify(validationError));
            }
            let projection = resolveFieldProjection({
                fields: input.fields,
                excludeFields: input.exclude_fields,
                allowedPaths: AUTOMATE_REQUEST_FIELD_PATHS,
            });
            const regexExcerptEnabled = input.serialization?.regex_excerpt !== undefined;
            projection = normalizeRegexExcerptProjection(regexExcerptEnabled, projection);
            const materialization = resolveHttpBodyMaterialization(
                input,
                projection,
                regexExcerptEnabled,
                false,
            );
            const serialization = normalizeHttpSerialization(input.serialization, materialization);
            const regexExcerpt = resolveRegexExcerpt(input.serialization);
            const response = await graphql.execute<AutomateEntryRequestsResponse>(
                LIST_AUTOMATE_ENTRY_REQUESTS_QUERY,
                {
                    id: input.entry_id,
                    ...paginationVariables(input),
                    filter: input.filter === undefined ? undefined : { code: input.filter },
                    order: {
                        by: input.order.by,
                        ordering: input.order.direction.toUpperCase(),
                    },
                    includeValues: shouldIncludeAutomateValues(projection),
                },
            );
            const entry = response.data?.automateEntry;
            if (entry === undefined || entry === null) {
                throw new Error(`Automate entry not found: ${input.entry_id}`);
            }
            const items = [];
            for (const { cursor, node } of entry.requests.edges) {
                items.push(
                    await serializeAutomateRequest({
                        sdk,
                        node,
                        cursor,
                        serialization,
                        regexExcerpt,
                    }),
                );
            }
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            entry: { id: entry.id, name: entry.name },
                            pageInfo: entry.requests.pageInfo,
                            snapshot: entry.requests.snapshot,
                            count: entry.requests.count.value,
                            items: applyProjectionToResults(items, projection),
                        }),
                    },
                ],
            };
        },
    });
};
