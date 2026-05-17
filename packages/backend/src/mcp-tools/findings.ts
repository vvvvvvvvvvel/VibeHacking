import { z } from "zod";

import {
    DELETE_FINDINGS_MUTATION,
    GET_FINDING_QUERY,
    LIST_FINDINGS_QUERY,
    UPDATE_FINDING_MUTATION,
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
import type { FieldProjection, ProjectedHttpSerializationOptionsInput } from "../history";
import { ToolGroupId } from "../tool-permissions";

import { listHttpSerializationSchema } from "./http-serialization-schema";
import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult, toDedupeKey, toId, toNumericId } from "./shared";

type FindingNode = {
    id: string;
    title: string;
    description?: string;
    host: string;
    path: string;
    reporter: string;
    dedupeKey?: string;
    hidden: boolean;
    createdAt: string | number;
    request: { id: string };
};

type FindingConnection = {
    pageInfo?: {
        hasPreviousPage?: boolean;
        hasNextPage?: boolean;
        startCursor?: string;
        endCursor?: string;
    };
    edges?: Array<{ cursor: string; node: FindingNode }>;
    snapshot?: string;
    count?: { value?: number };
};

type ListFindingsResponse = {
    findings?: FindingConnection;
};

type GetFindingResponse = {
    finding?: FindingNode;
};

type ListFindingsInput = {
    filter?: { reporter?: string };
    limit?: number;
    cursor?: string;
    direction?: "after" | "before";
    order?: {
        by?: "ID" | "TITLE" | "HOST" | "PATH" | "REPORTER" | "CREATED_AT";
        ordering?: "ASC" | "DESC";
    };
    include_http?: boolean;
    serialization?: ProjectedHttpSerializationOptionsInput;
    fields?: string[];
    exclude_fields?: string[];
};

const FINDING_FIELD_PATHS = new Set([
    "cursor",
    "id",
    "title",
    "description",
    "host",
    "path",
    "reporter",
    "dedupe_key",
    "hidden",
    "created_at",
    "request_id",
    "http",
    ...Array.from(HTTP_HISTORY_FIELD_PATHS).map((path) => `http.${path}`),
]);

const hasPathWithPrefix = (paths: Set<string> | undefined, prefix: string) => {
    if (paths === undefined) return false;
    for (const path of paths) {
        if (path === prefix || path.startsWith(`${prefix}.`)) return true;
    }
    return false;
};

const stripHttpProjection = (
    projection: FieldProjection | undefined,
): FieldProjection | undefined => {
    if (projection?.fields !== undefined) {
        if (projection.fields.has("http")) return undefined;
        const fields = Array.from(projection.fields)
            .filter((path) => path.startsWith("http."))
            .map((path) => path.slice("http.".length));
        return fields.length === 0 ? undefined : { fields: new Set(fields) };
    }
    if (projection?.excludeFields !== undefined) {
        const excludeFields = Array.from(projection.excludeFields)
            .filter((path) => path.startsWith("http."))
            .map((path) => path.slice("http.".length));
        return excludeFields.length === 0 ? undefined : { excludeFields: new Set(excludeFields) };
    }
    return undefined;
};

const cursorVariables = (input: Pick<ListFindingsInput, "limit" | "cursor" | "direction">) => {
    const limit = Math.max(1, Math.min(500, input.limit ?? 50));
    if (input.direction === "before") {
        return { last: limit, before: input.cursor };
    }
    return { first: limit, after: input.cursor };
};

const normalizePageInfo = (connection?: FindingConnection) => ({
    hasNextPage: connection?.pageInfo?.hasNextPage ?? false,
    hasPreviousPage: connection?.pageInfo?.hasPreviousPage ?? false,
    startCursor: connection?.pageInfo?.startCursor ?? null,
    endCursor: connection?.pageInfo?.endCursor ?? null,
});

const countValue = (connection?: FindingConnection) =>
    connection?.count?.value ?? connection?.edges?.length ?? 0;

const normalizeFinding = (node: FindingNode, cursor?: string, http?: unknown) => ({
    cursor,
    id: toNumericId(node.id),
    title: node.title,
    description: node.description ?? null,
    host: node.host,
    path: node.path,
    reporter: node.reporter,
    dedupeKey: node.dedupeKey ?? null,
    hidden: node.hidden,
    createdAt: node.createdAt,
    requestId: toNumericId(node.request.id),
    http,
});

export const registerFindingsTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const normalizeInputs = (input: { dedupe_keys?: string[]; request_ids?: string[] }) => {
        const normalizedDedupeKeys = input.dedupe_keys?.filter((key) => key.length > 0) ?? [];
        const normalizedRequestIds = input.request_ids?.filter((id) => id.length > 0) ?? [];
        return {
            normalizedDedupeKeys,
            normalizedRequestIds,
            hasDedupeKeys: normalizedDedupeKeys.length > 0,
            hasRequestIds: normalizedRequestIds.length > 0,
        };
    };

    const idSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const idArraySchema = z.array(idSchema);
    const requestIdSchema = idSchema;
    const requestIdArraySchema = z.array(requestIdSchema);
    const dedupeKeyArraySchema = z.array(z.string().min(1));
    const findingFilterSchema = z
        .object({
            reporter: z.string().min(1).optional(),
        })
        .strict();
    const findingOrderSchema = z
        .object({
            by: z
                .enum(["ID", "TITLE", "HOST", "PATH", "REPORTER", "CREATED_AT"])
                .default("CREATED_AT"),
            ordering: z.enum(["ASC", "DESC"]).default("DESC"),
        })
        .strict()
        .default({ by: "CREATED_AT", ordering: "DESC" });
    const listFindingsSchema = z
        .object({
            filter: findingFilterSchema
                .nullable()
                .default(null)
                .transform((value) => value ?? undefined),
            limit: z.number().int().min(1).max(500).default(50),
            cursor: z.string().min(1).optional(),
            direction: z.enum(["after", "before"]).default("after"),
            order: findingOrderSchema,
            include_http: z.boolean().default(false),
            serialization: listHttpSerializationSchema,
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
    const findingGetSchema = z
        .object({
            ids: idArraySchema.optional(),
            request_ids: requestIdArraySchema.optional(),
            reporter: z.string().min(1).optional(),
            dedupe_keys: dedupeKeyArraySchema.optional(),
        })
        .strict()
        .refine(
            (value) =>
                [
                    Boolean(value.ids && value.ids.length),
                    Boolean(value.dedupe_keys && value.dedupe_keys.length),
                    Boolean(value.request_ids && value.request_ids.length),
                ].filter(Boolean).length === 1,
            {
                message: "Provide exactly one of ids, dedupe_keys, or request_ids",
            },
        );
    const findingExistsSchema = z
        .object({
            request_ids: requestIdArraySchema.optional(),
            reporter: z.string().min(1).optional(),
            dedupe_keys: dedupeKeyArraySchema.optional(),
        })
        .strict()
        .refine(
            (value) =>
                Boolean(value.dedupe_keys && value.dedupe_keys.length) !==
                Boolean(value.request_ids && value.request_ids.length),
            {
                message: "Provide either dedupe_keys or request_ids",
            },
        );
    const findingCreateItemSchema = z
        .object({
            title: z.string().min(1),
            description: z.string().optional(),
            reporter: z.string().min(1),
            dedupe_key: z.string().min(1).optional(),
            request_id: idSchema,
        })
        .strict();
    const findingCreateSchema = z
        .object({ items: z.array(findingCreateItemSchema).min(1) })
        .strict();
    const findingUpdateItemSchema = z
        .object({
            id: idSchema,
            input: z
                .object({
                    title: z.string().min(1).optional(),
                    description: z.string().optional(),
                    hidden: z.boolean().optional(),
                })
                .strict()
                .refine(
                    (value) =>
                        value.title !== undefined ||
                        value.description !== undefined ||
                        value.hidden !== undefined,
                    { message: "Provide at least one field to update" },
                ),
        })
        .strict();
    const findingUpdateSchema = z
        .object({ items: z.array(findingUpdateItemSchema).min(1) })
        .strict();
    const findingDeleteSchema = z
        .object({
            ids: z.array(idSchema).min(1),
            reporter: z.string().min(1).optional(),
        })
        .strict();

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.findings.list",
        group: ToolGroupId.FindingSafe,
        toolName: "list_findings",
        description:
            "List findings with native cursor pagination, reporter filter, order, optional HTTP request/response serialization, and fields/exclude_fields projection. " +
            'Example: { "limit": 50, "filter": { "reporter": "mcp" }, "fields": ["cursor", "id", "title", "reporter", "request_id"] }.',
        inputSchema: listFindingsSchema,
        handler: async (params) => {
            const input = listFindingsSchema.parse(params) as ListFindingsInput;
            const projection = resolveFieldProjection({
                fields: input.fields,
                excludeFields: input.exclude_fields,
                allowedPaths: FINDING_FIELD_PATHS,
            });
            let httpProjection = stripHttpProjection(projection);
            const regexExcerptEnabled = input.serialization?.regex_excerpt !== undefined;
            httpProjection = normalizeRegexExcerptProjection(regexExcerptEnabled, httpProjection);
            const includeHttp =
                input.include_http === true ||
                regexExcerptEnabled ||
                hasPathWithPrefix(projection?.fields, "http");
            const materialization = resolveHttpBodyMaterialization(
                input,
                httpProjection,
                regexExcerptEnabled,
                false,
            );
            const serialization = normalizeHttpSerialization(input.serialization, materialization);
            const regexExcerpt = resolveRegexExcerpt(input.serialization);
            const response = await sdk.graphql.execute<ListFindingsResponse>(LIST_FINDINGS_QUERY, {
                ...cursorVariables(input),
                filter: input.filter,
                order: input.order,
            });
            if (response.errors !== undefined && response.errors.length > 0) {
                throw new Error(JSON.stringify(response.errors));
            }
            const connection = response.data?.findings;
            const items = [];
            for (const edge of connection?.edges ?? []) {
                let http: unknown;
                if (includeHttp) {
                    const pair = await sdk.requests.get(toId(edge.node.request.id));
                    const matchContext = buildHttpMatchContext(pair, regexExcerpt);
                    http = serializeHttpHistoryEntry({
                        pair,
                        options: serialization,
                        matchContext,
                        inScope:
                            pair?.request === undefined
                                ? undefined
                                : sdk.requests.inScope(pair.request),
                    });
                }
                items.push(normalizeFinding(edge.node, edge.cursor, http));
            }
            const payload = {
                pageInfo: normalizePageInfo(connection),
                snapshot: connection?.snapshot,
                count: countValue(connection),
                items: applyProjectionToResults(items, projection),
            };
            return { content: [{ type: "text", text: stringifyResult(payload) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.findings.get",
        group: ToolGroupId.FindingSafe,
        toolName: "get_finding",
        description:
            "Get findings by ids, request_ids, or dedupe_keys; provide exactly one lookup mode.",
        inputSchema: findingGetSchema,
        handler: async (params) => {
            const {
                ids: finding_ids,
                dedupe_keys,
                request_ids,
                reporter,
            } = findingGetSchema.parse(params);
            if (finding_ids !== undefined && finding_ids.length > 0) {
                const results = [];
                for (const id of finding_ids) {
                    const response = await sdk.graphql.execute<GetFindingResponse>(
                        GET_FINDING_QUERY,
                        { id },
                    );
                    const finding = response.data?.finding;
                    if (finding === undefined || finding === null) {
                        results.push({ id, found: false, error: response.errors });
                        continue;
                    }
                    results.push({ id, found: true, item: normalizeFinding(finding) });
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            }
            const { normalizedDedupeKeys, normalizedRequestIds, hasDedupeKeys, hasRequestIds } =
                normalizeInputs({ dedupe_keys, request_ids });
            if (!hasDedupeKeys && !hasRequestIds) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "error: provide exactly one of ids, dedupe_keys, or request_ids",
                        },
                    ],
                };
            }
            if (hasDedupeKeys) {
                const results = [];
                for (const key of normalizedDedupeKeys) {
                    const finding = await sdk.findings.get(toDedupeKey(key));
                    if (finding === undefined || finding === null) {
                        results.push({ dedupeKey: key, found: false });
                        continue;
                    }
                    results.push({
                        dedupeKey: key,
                        found: true,
                        id: String(finding.getId()),
                        title: finding.getTitle(),
                        description: finding.getDescription(),
                        reporter: finding.getReporter(),
                        requestId: finding.getRequestId(),
                    });
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            }
            const ids = normalizedRequestIds;
            const results = [];
            for (const id of ids) {
                const entry = await sdk.requests.get(toId(id));
                const request = entry?.request;
                if (request === undefined) {
                    results.push({ requestId: id, found: false, error: "(request not found)" });
                    continue;
                }
                const finding = await sdk.findings.get({
                    request,
                    reporter,
                });
                if (finding === undefined || finding === null) {
                    results.push({ requestId: id, found: false });
                    continue;
                }
                results.push({
                    requestId: id,
                    found: true,
                    id: String(finding.getId()),
                    title: finding.getTitle(),
                    description: finding.getDescription(),
                    reporter: finding.getReporter(),
                    dedupeKey: finding.getDedupeKey(),
                });
            }
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.findings.exists",
        group: ToolGroupId.FindingSafe,
        toolName: "finding_exists",
        description:
            "Check finding existence by request_ids or dedupe_keys; provide exactly one lookup mode.",
        inputSchema: findingExistsSchema,
        handler: async (params) => {
            const { dedupe_keys, request_ids, reporter } = findingExistsSchema.parse(params);
            const { normalizedDedupeKeys, normalizedRequestIds, hasDedupeKeys, hasRequestIds } =
                normalizeInputs({ dedupe_keys, request_ids });
            if (!hasDedupeKeys && !hasRequestIds) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "error: provide either dedupe_keys (array) or request_ids (array)",
                        },
                    ],
                };
            }
            if (hasDedupeKeys) {
                const results = [];
                for (const key of normalizedDedupeKeys) {
                    const exists = await sdk.findings.exists(toDedupeKey(key));
                    results.push({ dedupeKey: key, exists });
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            }
            const ids = normalizedRequestIds;
            const results = [];
            for (const id of ids) {
                const entry = await sdk.requests.get(toId(id));
                const request = entry?.request;
                if (request === undefined) {
                    results.push({
                        requestId: id,
                        exists: false,
                        error: "(request not found)",
                    });
                    continue;
                }
                const exists = await sdk.findings.exists({
                    request,
                    reporter,
                });
                results.push({ requestId: id, exists });
            }
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.findings.create",
        group: ToolGroupId.FindingSafe,
        toolName: "create_finding",
        description:
            "Create findings for saved requests. " +
            'Example: { "items": [{ "title": "Auth bypass", "reporter": "mcp", "request_id": 1 }] }.',
        inputSchema: findingCreateSchema,
        handler: async (params) => {
            const { items } = findingCreateSchema.parse(params);
            const results = [];
            for (const item of items) {
                const entry = await sdk.requests.get(toId(item.request_id));
                const request = entry?.request;
                if (request === undefined) {
                    results.push({
                        requestId: item.request_id,
                        error: "(request not found)",
                    });
                    continue;
                }
                const finding = await sdk.findings.create({
                    title: item.title,
                    description: item.description,
                    reporter: item.reporter,
                    dedupeKey: item.dedupe_key,
                    request,
                });
                results.push({
                    id: toNumericId(String(finding.getId())),
                    title: finding.getTitle(),
                    reporter: finding.getReporter(),
                    requestId: toNumericId(String(finding.getRequestId())),
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
        action: "sdk.findings.update",
        group: ToolGroupId.FindingUnsafe,
        toolName: "update_finding",
        description: "Update findings by ID.",
        inputSchema: findingUpdateSchema,
        handler: async (params) => {
            const { items } = findingUpdateSchema.parse(params);
            const results = await Promise.all(
                items.map(async (item) => {
                    const response = await sdk.graphql.execute(UPDATE_FINDING_MUTATION, item);
                    return { id: item.id, result: response.data ?? response };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.findings.delete",
        group: ToolGroupId.FindingUnsafe,
        toolName: "delete_finding",
        description: "Delete findings by IDs.",
        inputSchema: findingDeleteSchema,
        handler: async (params) => {
            const { ids, reporter } = findingDeleteSchema.parse(params);
            const response = await sdk.graphql.execute(DELETE_FINDINGS_MUTATION, {
                input: { ids, reporter },
            });
            const errors = (response as { errors?: Array<{ message?: string }> }).errors;
            const hasUnknownInput =
                errors?.some((error) =>
                    String(error?.message ?? "").includes('Unknown argument "input"'),
                ) ?? false;
            if (hasUnknownInput) {
                const fallback = await sdk.graphql.execute(
                    `
                          mutation deleteFindings($ids: [ID!]!, $reporter: String) {
                            deleteFindings(ids: $ids, reporter: $reporter) {
                              deletedIds
                            }
                          }
                        `,
                    { ids, reporter },
                );
                return {
                    content: [{ type: "text", text: stringifyResult(fallback.data ?? fallback) }],
                };
            }
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });
};
