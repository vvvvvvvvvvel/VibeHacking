import { z } from "zod";

import {
    GET_SITEMAP_ENTRY_QUERY,
    LIST_SITEMAP_DESCENDANTS_QUERY,
    LIST_SITEMAP_ENTRY_REQUESTS_QUERY,
    LIST_SITEMAP_ROOTS_QUERY,
} from "../graphql";
import {
    applyProjectionToLookupResults,
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
import type { FieldProjection, SerializedHttpHistoryListEntry } from "../history";
import { ToolGroupId } from "../tool-permissions";

import { listHttpSerializationSchema } from "./http-serialization-schema";
import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult, toId, toNumericId } from "./shared";

type SitemapEntryKind = "DOMAIN" | "DIRECTORY" | "REQUEST" | "REQUEST_QUERY" | "REQUEST_BODY";

type PageInfoNode = {
    hasPreviousPage?: boolean;
    hasNextPage?: boolean;
    startCursor?: string;
    endCursor?: string;
};

type CountNode = { value?: number };

type SitemapResponseNode = {
    id: string;
    statusCode: number;
    length?: number;
    roundtripTime?: number;
    alteration?: string;
    edited?: boolean;
    createdAt?: string | number;
};

type SitemapRequestNode = {
    id: string;
    host: string;
    method: string;
    path: string;
    query?: string;
    length?: number;
    port: number;
    isTls: boolean;
    sni?: string;
    fileExtension?: string;
    source?: string;
    alteration?: string;
    edited?: boolean;
    createdAt?: string | number;
    response?: SitemapResponseNode;
};

type SitemapRequestConnection = {
    pageInfo?: PageInfoNode;
    edges?: Array<{ cursor: string; node: SitemapRequestNode }>;
    nodes?: SitemapRequestNode[];
    snapshot?: string;
    count?: CountNode;
};

type SitemapEntryNode = {
    id: string;
    label: string;
    kind: SitemapEntryKind;
    parentId?: string;
    metadata?: { port?: number; isTls?: boolean };
    hasDescendants: boolean;
    request?: SitemapRequestNode;
    requests?: SitemapRequestConnection;
};

type SitemapEntryConnection = {
    pageInfo?: PageInfoNode;
    nodes?: SitemapEntryNode[];
    snapshot?: string;
    count?: CountNode;
};

type SitemapRootEntriesResponse = {
    sitemapRootEntries?: SitemapEntryConnection;
};

type SitemapDescendantEntriesResponse = {
    sitemapDescendantEntries?: SitemapEntryConnection;
};

type SitemapEntryResponse = {
    sitemapEntry?: SitemapEntryNode;
};

type SitemapEntryRequestsResponse = {
    sitemapEntry?: {
        id: string;
        label: string;
        kind: SitemapEntryKind;
        parentId?: string;
        requests?: SitemapRequestConnection;
    };
};

type SitemapEntryFilter = {
    kinds?: SitemapEntryKind[];
    label_regex?: string;
    has_descendants?: boolean;
    has_direct_request?: boolean;
    min_request_count?: number;
    max_request_count?: number;
};

type NormalizedSitemapRequest = {
    id: number | string;
    method: string;
    url: string;
    host: string;
    path: string;
    query?: string;
    length?: number;
    port: number;
    secure: boolean;
    sni?: string;
    fileExtension?: string;
    source?: string;
    alteration?: string;
    edited?: boolean;
    createdAt?: string;
    response?: {
        id: number | string;
        statusCode: number;
        length?: number;
        roundtripTime?: number;
        alteration?: string;
        edited?: boolean;
        createdAt?: string;
    };
};

type NormalizedSitemapRequestConnection = {
    count: number;
    items?: NormalizedSitemapRequest[];
};

type NormalizedSitemapEntry = {
    id: number | string;
    label: string;
    kind: SitemapEntryKind;
    parentId?: number | string;
    metadata?: { port?: number; isTls?: boolean };
    hasDescendants: boolean;
    directRequest?: NormalizedSitemapRequest;
    requests?: NormalizedSitemapRequestConnection;
};

const SITEMAP_ENTRY_FIELD_PATHS = new Set([
    "id",
    "label",
    "kind",
    "parent_id",
    "metadata",
    "metadata.port",
    "metadata.is_tls",
    "has_descendants",
    "direct_request",
    "direct_request.id",
    "direct_request.method",
    "direct_request.url",
    "direct_request.host",
    "direct_request.path",
    "direct_request.query",
    "direct_request.length",
    "direct_request.port",
    "direct_request.secure",
    "direct_request.sni",
    "direct_request.file_extension",
    "direct_request.source",
    "direct_request.alteration",
    "direct_request.edited",
    "direct_request.created_at",
    "direct_request.response",
    "direct_request.response.id",
    "direct_request.response.status_code",
    "direct_request.response.length",
    "direct_request.response.roundtrip_time",
    "direct_request.response.alteration",
    "direct_request.response.edited",
    "direct_request.response.created_at",
    "requests",
    "requests.count",
    "requests.items",
    "requests.items.id",
    "requests.items.method",
    "requests.items.url",
    "requests.items.host",
    "requests.items.path",
    "requests.items.query",
    "requests.items.length",
    "requests.items.port",
    "requests.items.secure",
    "requests.items.sni",
    "requests.items.file_extension",
    "requests.items.source",
    "requests.items.alteration",
    "requests.items.edited",
    "requests.items.created_at",
    "requests.items.response",
    "requests.items.response.id",
    "requests.items.response.status_code",
    "requests.items.response.length",
    "requests.items.response.roundtrip_time",
    "requests.items.response.alteration",
    "requests.items.response.edited",
    "requests.items.response.created_at",
]);

const idSchema = z
    .union([z.string().min(1), z.number().int().nonnegative()])
    .transform((value) => String(value));

const sitemapKindSchema = z.enum([
    "DOMAIN",
    "DIRECTORY",
    "REQUEST",
    "REQUEST_QUERY",
    "REQUEST_BODY",
]);

const requestOrderSchema = z
    .object({
        by: z
            .enum([
                "CREATED_AT",
                "FILE_EXTENSION",
                "HOST",
                "ID",
                "METHOD",
                "PATH",
                "QUERY",
                "SOURCE",
                "RESP_STATUS_CODE",
                "RESP_ROUNDTRIP_TIME",
                "RESP_LENGTH",
            ])
            .default("ID"),
        ordering: z.enum(["ASC", "DESC"]).default("ASC"),
    })
    .strict()
    .default({ by: "ID", ordering: "ASC" });

const entryFilterSchema = z
    .object({
        kinds: z.array(sitemapKindSchema).min(1).optional(),
        label_regex: z.string().min(1).optional(),
        has_descendants: z.boolean().optional(),
        has_direct_request: z.boolean().optional(),
        min_request_count: z.number().int().min(0).optional(),
        max_request_count: z.number().int().min(0).optional(),
    })
    .superRefine((filter, ctx) => {
        if (
            filter.min_request_count !== undefined &&
            filter.max_request_count !== undefined &&
            filter.min_request_count > filter.max_request_count
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "min_request_count must be less than or equal to max_request_count",
                path: ["min_request_count"],
            });
        }
    })
    .strict()
    .default({});

const fieldProjectionShape = {
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
};

const listSitemapEntriesBaseShape = {
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(1000).default(100),
    filter: entryFilterSchema,
    request_limit: z.number().int().min(0).max(50).default(0),
    request_order: requestOrderSchema,
    ...fieldProjectionShape,
};

const listSitemapRootsSchema = z
    .object({
        scope_id: idSchema.nullable().default(null),
        ...listSitemapEntriesBaseShape,
    })
    .strict();

const listSitemapDescendantsSchema = z
    .object({
        parent_id: idSchema,
        depth: z.enum(["DIRECT", "ALL"]).default("DIRECT"),
        ...listSitemapEntriesBaseShape,
    })
    .strict();

const getSitemapEntriesSchema = z
    .object({
        ids: z.array(idSchema).min(1),
        request_limit: z.number().int().min(0).max(50).default(0),
        request_order: requestOrderSchema,
        ...fieldProjectionShape,
    })
    .strict();

const listSitemapEntryRequestsSchema = z
    .object({
        entry_id: idSchema,
        limit: z.number().int().min(1).max(500).default(50),
        cursor: z.string().min(1).optional(),
        direction: z.enum(["after", "before"]).default("after"),
        order: requestOrderSchema,
        serialization: listHttpSerializationSchema,
        ...fieldProjectionShape,
    })
    .strict();

const normalizePageInfo = (pageInfo?: PageInfoNode) => ({
    hasNextPage: pageInfo?.hasNextPage ?? false,
    hasPreviousPage: pageInfo?.hasPreviousPage ?? false,
    startCursor: pageInfo?.startCursor ?? null,
    endCursor: pageInfo?.endCursor ?? null,
});

const countValue = (connection?: { count?: CountNode; nodes?: unknown[]; edges?: unknown[] }) =>
    connection?.count?.value ?? connection?.nodes?.length ?? connection?.edges?.length ?? 0;

const defined = <T>(value: T | undefined): value is T => value !== undefined;

const normalizeDateTime = (value: unknown) => {
    if (value === null || value === undefined || value === "") return undefined;
    if (typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
    }
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== "string") return undefined;
    const numeric = Number(value);
    if (/^\d+$/.test(value) && Number.isFinite(numeric)) {
        const date = new Date(numeric);
        return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
    return value;
};

const buildRequestUrl = (request: SitemapRequestNode) => {
    const scheme = request.isTls ? "https" : "http";
    const defaultPort = request.isTls ? 443 : 80;
    const port = request.port === defaultPort ? "" : `:${request.port}`;
    const query = request.query !== undefined && request.query !== "" ? `?${request.query}` : "";
    const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
    return `${scheme}://${request.host}${port}${path}${query}`;
};

const normalizeResponse = (response?: SitemapResponseNode) => {
    if (response === undefined || response === null) return undefined;
    return {
        id: toNumericId(response.id),
        statusCode: response.statusCode,
        length: response.length ?? undefined,
        roundtripTime: response.roundtripTime ?? undefined,
        alteration: response.alteration ?? undefined,
        edited: response.edited ?? undefined,
        createdAt: normalizeDateTime(response.createdAt),
    };
};

const normalizeRequest = (request?: SitemapRequestNode): NormalizedSitemapRequest | undefined => {
    if (request === undefined || request === null) return undefined;
    return {
        id: toNumericId(request.id),
        method: request.method,
        url: buildRequestUrl(request),
        host: request.host,
        path: request.path,
        query: request.query ?? undefined,
        length: request.length ?? undefined,
        port: request.port,
        secure: request.isTls,
        sni: request.sni ?? undefined,
        fileExtension: request.fileExtension ?? undefined,
        source: request.source ?? undefined,
        alteration: request.alteration ?? undefined,
        edited: request.edited ?? undefined,
        createdAt: normalizeDateTime(request.createdAt),
        response: normalizeResponse(request.response),
    };
};

const normalizeRequestConnection = (
    connection?: SitemapRequestConnection,
    includeItems = false,
): NormalizedSitemapRequestConnection => {
    const count = countValue(connection);
    if (!includeItems) return { count };
    return {
        count,
        items: (connection?.nodes ?? []).map(normalizeRequest).filter(defined),
    };
};

const normalizeEntry = (
    entry: SitemapEntryNode,
    includeRequestItems = false,
): NormalizedSitemapEntry => {
    const metadata =
        entry.metadata === undefined || entry.metadata === null
            ? undefined
            : {
                  port: entry.metadata.port ?? undefined,
                  isTls: entry.metadata.isTls ?? undefined,
              };
    return {
        id: toNumericId(entry.id),
        label: entry.label,
        kind: entry.kind,
        parentId:
            entry.parentId === undefined || entry.parentId === null
                ? undefined
                : toNumericId(entry.parentId),
        metadata,
        hasDescendants: entry.hasDescendants,
        directRequest: normalizeRequest(entry.request),
        requests: normalizeRequestConnection(entry.requests, includeRequestItems),
    };
};

const makeRegex = (pattern: string | undefined) => {
    if (pattern === undefined) return undefined;
    try {
        return new RegExp(pattern, "i");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid label_regex: ${message}`);
    }
};

const applyEntryFilter = (entries: NormalizedSitemapEntry[], filter: SitemapEntryFilter) => {
    const labelRegex = makeRegex(filter.label_regex);
    const kinds = filter.kinds === undefined ? undefined : new Set(filter.kinds);
    return entries.filter((entry) => {
        if (kinds !== undefined && !kinds.has(entry.kind)) return false;
        if (labelRegex !== undefined && !labelRegex.test(entry.label)) return false;
        if (
            filter.has_descendants !== undefined &&
            entry.hasDescendants !== filter.has_descendants
        ) {
            return false;
        }
        if (
            filter.has_direct_request !== undefined &&
            (entry.directRequest !== undefined) !== filter.has_direct_request
        ) {
            return false;
        }
        const requestCount = entry.requests?.count ?? 0;
        if (filter.min_request_count !== undefined && requestCount < filter.min_request_count) {
            return false;
        }
        if (filter.max_request_count !== undefined && requestCount > filter.max_request_count) {
            return false;
        }
        return true;
    });
};

const resolveEntryProjection = (input: { fields?: string[]; exclude_fields?: string[] }) =>
    resolveFieldProjection({
        fields: input.fields,
        excludeFields: input.exclude_fields,
        allowedPaths: SITEMAP_ENTRY_FIELD_PATHS,
    });

const resolveRequestProjection = (input: { fields?: string[]; exclude_fields?: string[] }) =>
    resolveFieldProjection({
        fields: input.fields,
        excludeFields: input.exclude_fields,
        allowedPaths: HTTP_HISTORY_FIELD_PATHS,
    });

const requestsItemsProjected = (fields: string[] | undefined) =>
    fields?.some(
        (path) =>
            path === "requests" || path === "requests.items" || path.startsWith("requests.items."),
    ) === true;

const shouldIncludeEntryRequestItems = (input: { request_limit: number; fields?: string[] }) =>
    input.request_limit > 0 || requestsItemsProjected(input.fields);

const assertNoGraphqlErrors = (response: { errors?: unknown[] }) => {
    if (response.errors !== undefined && response.errors.length > 0) {
        throw new Error(JSON.stringify(response.errors));
    }
};

const pagedEntriesPayload = ({
    connection,
    entries,
    offset,
    limit,
    projection,
}: {
    connection?: SitemapEntryConnection;
    entries: NormalizedSitemapEntry[];
    offset: number;
    limit: number;
    projection: FieldProjection | undefined;
}) => {
    const items = entries.slice(offset, offset + limit);
    const previousOffset = offset > 0 ? Math.max(0, offset - limit) : undefined;
    const nextOffset = offset + items.length < entries.length ? offset + items.length : undefined;
    return {
        sourceCount: countValue(connection),
        matched: entries.length,
        returned: items.length,
        offset,
        limit,
        hasMore: nextOffset !== undefined,
        previousOffset,
        nextOffset,
        items: applyProjectionToResults(items, projection),
    };
};

const requestConnectionVariables = (input: {
    limit?: number;
    cursor?: string;
    direction?: "after" | "before";
}) => {
    const limit = Math.max(1, Math.min(500, input.limit ?? 50));
    if (input.direction === "before") {
        return { last: limit, before: input.cursor };
    }
    return { first: limit, after: input.cursor };
};

const serializeSitemapEntryRequestConnection = async ({
    sdk,
    connection,
    input,
    projection,
}: {
    sdk: ToolContext["sdk"];
    connection?: SitemapRequestConnection;
    input: z.infer<typeof listSitemapEntryRequestsSchema>;
    projection: FieldProjection | undefined;
}) => {
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
    const items: SerializedHttpHistoryListEntry[] = [];
    for (const edge of connection?.edges ?? []) {
        const pair = await sdk.requests.get(toId(edge.node.id));
        const matchContext = buildHttpMatchContext(pair, regexExcerpt);
        const item = serializeHttpHistoryEntry({
            pair,
            options: serialization,
            matchContext,
            inScope: pair?.request === undefined ? undefined : sdk.requests.inScope(pair.request),
            cursor: edge.cursor,
        });
        if (item !== undefined) items.push(item);
    }
    return {
        pageInfo: normalizePageInfo(connection?.pageInfo),
        snapshot: connection?.snapshot ?? undefined,
        count: countValue(connection),
        items: applyProjectionToResults(items, projection),
    };
};

export const registerSitemapTools = ({ server, sdk, store, permissions }: ToolContext) => {
    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.sitemap.listRoots",
        group: ToolGroupId.SitemapSafe,
        toolName: "list_sitemap_roots",
        description:
            "List root Sitemap entries (usually domains) with optional scope, entry filtering, request counts/samples, offset/limit output slicing, and fields/exclude_fields projection. " +
            'Example: { "limit": 50, "fields": ["id", "label", "kind", "metadata", "requests.count"] }.',
        inputSchema: listSitemapRootsSchema,
        handler: async (params) => {
            const input = listSitemapRootsSchema.parse(params);
            const projection = resolveEntryProjection(input);
            const includeRequestItems = shouldIncludeEntryRequestItems(input);
            const response = await sdk.graphql.execute<SitemapRootEntriesResponse>(
                LIST_SITEMAP_ROOTS_QUERY,
                {
                    scopeId: input.scope_id ?? undefined,
                    requestFirst: input.request_limit,
                    requestOrder: input.request_order,
                },
            );
            assertNoGraphqlErrors(response);
            const connection = response.data?.sitemapRootEntries;
            const entries = applyEntryFilter(
                (connection?.nodes ?? []).map((entry) =>
                    normalizeEntry(entry, includeRequestItems),
                ),
                input.filter,
            );
            const payload = pagedEntriesPayload({
                connection,
                entries,
                offset: input.offset,
                limit: input.limit,
                projection,
            });
            return { content: [{ type: "text", text: stringifyResult(payload) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.sitemap.listDescendants",
        group: ToolGroupId.SitemapSafe,
        toolName: "list_sitemap_descendants",
        description:
            "List direct or all descendants for one Sitemap entry with filtering, request counts/samples, offset/limit output slicing, and fields/exclude_fields projection. " +
            'Example: { "parent_id": 1, "depth": "DIRECT", "limit": 100, "filter": { "kinds": ["DIRECTORY", "REQUEST"] } }.',
        inputSchema: listSitemapDescendantsSchema,
        handler: async (params) => {
            const input = listSitemapDescendantsSchema.parse(params);
            const projection = resolveEntryProjection(input);
            const includeRequestItems = shouldIncludeEntryRequestItems(input);
            const response = await sdk.graphql.execute<SitemapDescendantEntriesResponse>(
                LIST_SITEMAP_DESCENDANTS_QUERY,
                {
                    parentId: input.parent_id,
                    depth: input.depth,
                    requestFirst: input.request_limit,
                    requestOrder: input.request_order,
                },
            );
            assertNoGraphqlErrors(response);
            const connection = response.data?.sitemapDescendantEntries;
            const entries = applyEntryFilter(
                (connection?.nodes ?? []).map((entry) =>
                    normalizeEntry(entry, includeRequestItems),
                ),
                input.filter,
            );
            const payload = pagedEntriesPayload({
                connection,
                entries,
                offset: input.offset,
                limit: input.limit,
                projection,
            });
            return { content: [{ type: "text", text: stringifyResult(payload) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.sitemap.getEntriesByIds",
        group: ToolGroupId.SitemapSafe,
        toolName: "get_sitemap_entries_by_ids",
        description:
            "Fetch exact Sitemap entries by ID with request counts/samples and fields/exclude_fields projection. " +
            'Example: { "ids": [1, 2], "request_limit": 3 }.',
        inputSchema: getSitemapEntriesSchema,
        handler: async (params) => {
            const input = getSitemapEntriesSchema.parse(params);
            const projection = resolveEntryProjection(input);
            const includeRequestItems = shouldIncludeEntryRequestItems(input);
            const results = [];
            for (const id of input.ids) {
                const response = await sdk.graphql.execute<SitemapEntryResponse>(
                    GET_SITEMAP_ENTRY_QUERY,
                    {
                        id,
                        requestFirst: input.request_limit,
                        requestOrder: input.request_order,
                    },
                );
                assertNoGraphqlErrors(response);
                const entry = response.data?.sitemapEntry;
                if (entry === undefined || entry === null) {
                    results.push({ id, error: "not found" });
                } else {
                    results.push({ id, item: normalizeEntry(entry, includeRequestItems) });
                }
            }
            const payload = {
                requested: input.ids.length,
                found: results.filter((item) => "item" in item).length,
                results: applyProjectionToLookupResults(results, projection),
            };
            return { content: [{ type: "text", text: stringifyResult(payload) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.sitemap.listEntryRequests",
        group: ToolGroupId.SitemapSafe,
        toolName: "list_sitemap_entry_requests",
        description:
            "List saved requests associated with one Sitemap entry using native cursor pagination, order, HTTP history serialization controls, regex_excerpt, and fields/exclude_fields projection. " +
            'Example: { "entry_id": 1, "limit": 50, "fields": ["cursor", "id", "request.method", "request.url", "response.status_code"] }.',
        inputSchema: listSitemapEntryRequestsSchema,
        handler: async (params) => {
            const input = listSitemapEntryRequestsSchema.parse(params);
            const projection = resolveRequestProjection(input);
            const response = await sdk.graphql.execute<SitemapEntryRequestsResponse>(
                LIST_SITEMAP_ENTRY_REQUESTS_QUERY,
                {
                    id: input.entry_id,
                    ...requestConnectionVariables(input),
                    order: input.order,
                },
            );
            assertNoGraphqlErrors(response);
            const entry = response.data?.sitemapEntry;
            if (entry === undefined || entry === null) {
                throw new Error(`Sitemap entry not found: ${input.entry_id}`);
            }
            const requests = await serializeSitemapEntryRequestConnection({
                sdk,
                connection: entry.requests,
                input,
                projection,
            });
            const payload = {
                entry: {
                    id: toNumericId(entry.id),
                    label: entry.label,
                    kind: entry.kind,
                    parentId:
                        entry.parentId === undefined || entry.parentId === null
                            ? null
                            : toNumericId(entry.parentId),
                },
                pageInfo: requests.pageInfo,
                snapshot: requests.snapshot,
                count: requests.count,
                items: applyProjectionToResults(requests.items, projection),
            };
            return { content: [{ type: "text", text: stringifyResult(payload) }] };
        },
    });
};
