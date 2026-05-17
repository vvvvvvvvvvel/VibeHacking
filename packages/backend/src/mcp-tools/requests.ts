import type { RequestOrderField, ResponseOrderField } from "caido:utils";
import { z } from "zod";

import {
    applyProjectionToLookupResults,
    applyProjectionToResults,
    buildMatchContext,
    DEFAULT_MAX_BINARY_BODY_BYTES,
    DEFAULT_MAX_TEXT_BODY_CHARS,
    HTTP_HISTORY_FIELD_PATHS,
    normalizeHttpSerialization,
    previewValue,
    resolveFieldProjection,
    resolveHttpMaterialization,
    resolveRegexExcerpt,
    serializeHttpRequest,
    serializeHttpResponse,
    validateRegexExcerptProjection,
} from "../history";
import type {
    FieldProjection,
    HttpSerializationOptions,
    MatchContext,
    ProjectedHttpSerializationOptionsInput,
    SerializedHttpHistoryEntry,
} from "../history";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import {
    HTTPQL_HELP_SHORT,
    stringifyResult,
    toCursor,
    toId,
    toNumericId,
    validateHttpqlClause,
} from "./shared";

type RequestPair = Awaited<ReturnType<ToolContext["sdk"]["requests"]["get"]>>;
type RequestQuery = ReturnType<ToolContext["sdk"]["requests"]["query"]>;

type ListRequestInput = {
    filter?: string;
    limit?: number;
    cursor?: string;
    direction?: "after" | "before";
    order?:
        | { target: "req"; field: RequestOrderField; direction?: "asc" | "desc" }
        | { target: "resp"; field: ResponseOrderField; direction?: "asc" | "desc" };
    serialization?: ProjectedHttpSerializationOptionsInput;
    fields?: string[];
    exclude_fields?: string[];
};

type RequestLookupInput = {
    ids: string[];
    serialization?: ProjectedHttpSerializationOptionsInput;
    fields?: string[];
    exclude_fields?: string[];
};

type RequestPageInput = Pick<
    ListRequestInput,
    "filter" | "limit" | "cursor" | "direction" | "order"
>;

const idSchema = z.preprocess(
    (value) => (typeof value === "number" ? String(value) : value),
    z.string().min(1),
);

const idArraySchema = z.array(idSchema).min(1);

const DEFAULT_REGEX_EXCERPT_CONTEXT_CHARS = 10;

const defaultListHttpSerialization = {
    include_body: false,
    include_binary: false,
    max_text_body_chars: DEFAULT_MAX_TEXT_BODY_CHARS,
    text_overflow_mode: "omit" as const,
    max_binary_body_bytes: DEFAULT_MAX_BINARY_BODY_BYTES,
} satisfies ProjectedHttpSerializationOptionsInput;

const defaultHttpSerialization = {
    include_body: true,
    include_binary: false,
    max_text_body_chars: DEFAULT_MAX_TEXT_BODY_CHARS,
    text_overflow_mode: "omit" as const,
    max_binary_body_bytes: DEFAULT_MAX_BINARY_BODY_BYTES,
} satisfies ProjectedHttpSerializationOptionsInput;

const regexExcerptSchema = z
    .object({
        context_chars: z.number().int().min(0).default(DEFAULT_REGEX_EXCERPT_CONTEXT_CHARS),
        regex: z.string().min(1).optional(),
    })
    .strict();

const makeSerializationSchema = (defaults: ProjectedHttpSerializationOptionsInput) => {
    const fieldDefaults = {
        include_body: defaults.include_body ?? true,
        include_binary: defaults.include_binary ?? false,
        max_text_body_chars: defaults.max_text_body_chars ?? DEFAULT_MAX_TEXT_BODY_CHARS,
        max_request_body_chars: defaults.max_request_body_chars ?? null,
        max_response_body_chars: defaults.max_response_body_chars ?? null,
        text_overflow_mode: defaults.text_overflow_mode ?? "omit",
        max_binary_body_bytes: defaults.max_binary_body_bytes ?? DEFAULT_MAX_BINARY_BODY_BYTES,
        regex_excerpt: null,
    } as const;
    const objectDefault = {
        ...fieldDefaults,
        max_request_body_chars: undefined,
        max_response_body_chars: undefined,
        regex_excerpt: undefined,
    };
    return z
        .object({
            include_body: z.boolean().default(fieldDefaults.include_body),
            include_binary: z.boolean().default(fieldDefaults.include_binary),
            max_text_body_chars: z.number().int().min(0).default(fieldDefaults.max_text_body_chars),
            max_request_body_chars: z
                .number()
                .int()
                .min(0)
                .nullable()
                .default(null)
                .transform((value) => value ?? undefined),
            max_response_body_chars: z
                .number()
                .int()
                .min(0)
                .nullable()
                .default(null)
                .transform((value) => value ?? undefined),
            text_overflow_mode: z
                .enum(["truncate", "omit"])
                .default(fieldDefaults.text_overflow_mode),
            max_binary_body_bytes: z
                .number()
                .int()
                .min(0)
                .default(fieldDefaults.max_binary_body_bytes),
            regex_excerpt: regexExcerptSchema
                .nullable()
                .default(null)
                .transform((value) => value ?? undefined),
        })
        .strict()
        .default(objectDefault);
};

const listSerializationSchema = makeSerializationSchema(defaultListHttpSerialization);

const serializationSchema = makeSerializationSchema(defaultHttpSerialization);

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
                    direction: z.enum(["asc", "desc"]).default("asc"),
                })
                .strict(),
            z
                .object({
                    target: z.literal("resp"),
                    field: z.enum(["length", "roundtrip", "code"]),
                    direction: z.enum(["asc", "desc"]).default("asc"),
                })
                .strict(),
        ])
        .default({ target: "req", field: "id", direction: "asc" }),
);

const listRequestsSchema = z
    .object({
        filter: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(500).default(50),
        cursor: z.string().min(1).optional(),
        direction: z.enum(["after", "before"]).default("after"),
        order: orderSchema,
        serialization: listSerializationSchema,
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

const getRequestsSchema = z
    .object({
        ids: idArraySchema,
        serialization: serializationSchema,
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

const matchRequestsSchema = z
    .object({
        httpql: z.string().min(1),
        ids: idArraySchema,
    })
    .strict();

const sendRequestTimeoutsSchema = z
    .object({
        connect: z.number().int().min(0).optional(),
        partial: z.number().int().min(0).optional(),
        extra: z.number().int().min(0).optional(),
        response: z.number().int().min(0).optional(),
        global: z.number().int().min(0).optional(),
    })
    .strict();

const sendRequestOptionsSchema = z
    .object({
        timeouts: z.union([z.number().int().min(0), sendRequestTimeoutsSchema]).optional(),
        save: z.boolean().optional(),
        plugins: z.boolean().optional(),
    })
    .strict();

const sendRequestsSchema = z
    .object({
        ids: idArraySchema,
        options: sendRequestOptionsSchema.nullable().optional(),
        serialization: serializationSchema,
    })
    .strict();

const scopeCheckSchema = z
    .object({
        items: z
            .array(
                z
                    .object({
                        ids: idArraySchema,
                        scope_ids: z.array(idSchema).optional(),
                    })
                    .strict(),
            )
            .min(1),
    })
    .strict();

const summarySchema = z
    .object({
        limit: z.number().int().min(1).max(500).default(50),
        cursor: z.string().min(1).optional(),
        direction: z.enum(["after", "before"]).default("after"),
        order: orderSchema,
        filter: z.string().min(1).optional(),
    })
    .strict();

const bodyText = (body?: { toText?: () => string }) => {
    try {
        return body?.toText?.();
    } catch {
        return undefined;
    }
};

const requestMatchSources = (pair: RequestPair) => {
    const request = pair?.request;
    if (request === undefined) return [];
    const response = pair?.response;
    return [
        { path: "request.method", text: request.getMethod() },
        { path: "request.url", text: request.getUrl() },
        { path: "request.headers", text: JSON.stringify(request.getHeaders()) },
        { path: "request.body.text", text: bodyText(request.getBody()) },
        { path: "request.raw.text", text: bodyText(request.getRaw()) },
        { path: "response.status_code", text: response?.getCode()?.toString() },
        { path: "response.headers", text: JSON.stringify(response?.getHeaders() ?? {}) },
        { path: "response.body.text", text: bodyText(response?.getBody()) },
        { path: "response.raw.text", text: bodyText(response?.getRaw()) },
    ];
};

const serializedEntry = (
    sdk: ToolContext["sdk"],
    pair: RequestPair,
    options: HttpSerializationOptions,
    matchContext: MatchContext | undefined,
): SerializedHttpHistoryEntry | undefined => {
    if (pair?.request === undefined) return undefined;
    const inScope = sdk.requests.inScope(pair.request);
    return {
        id: toNumericId(String(pair.request.getId())),
        time: pair.request.getCreatedAt().toISOString(),
        inScope,
        request: { ...serializeHttpRequest(pair.request, options), inScope },
        response: serializeHttpResponse(pair.response, options),
        matchContext,
    };
};

const resolveBodyMaterialization = (
    input: { serialization?: ProjectedHttpSerializationOptionsInput },
    projection: FieldProjection | undefined,
    regexExcerptEnabled: boolean,
    defaultIncludeBody: boolean,
) => {
    const materialization = resolveHttpMaterialization(projection, regexExcerptEnabled);
    if (projection?.fields !== undefined) return materialization;
    const includeBody = input.serialization?.include_body ?? defaultIncludeBody;
    return {
        ...materialization,
        includeRequestBody: materialization.includeRequestBody && includeBody,
        includeResponseBody: materialization.includeResponseBody && includeBody,
    };
};

const applyRequestOrder = <T extends RequestQuery>(
    query: T,
    order: NonNullable<ListRequestInput["order"]>,
) => {
    const direction = order.direction ?? "asc";
    if (order.target === "req") {
        return direction === "asc"
            ? query.ascending("req", order.field)
            : query.descending("req", order.field);
    }
    return direction === "asc"
        ? query.ascending("resp", order.field)
        : query.descending("resp", order.field);
};

const executeRequestPage = async (sdk: ToolContext["sdk"], input: RequestPageInput) => {
    let query = sdk.requests.query();
    if (input.filter !== undefined && input.filter.trim() !== "") {
        const validationError = await validateHttpqlClause(sdk, input.filter);
        if (validationError !== null) throw new Error(JSON.stringify(validationError));
        query = query.filter(input.filter);
    }
    if (input.cursor !== undefined && input.direction === "before") {
        query = query.before(toCursor(input.cursor));
    } else if (input.cursor !== undefined) {
        query = query.after(toCursor(input.cursor));
    }
    const order = input.order ?? { target: "req", field: "id", direction: "asc" as const };
    query = applyRequestOrder(query, order);
    const limit = Math.max(1, Math.min(500, input.limit ?? 50));
    return await (input.direction === "before" ? query.last(limit) : query.first(limit)).execute();
};

const queryRequestPage = async (
    sdk: ToolContext["sdk"],
    input: ListRequestInput,
    projection: FieldProjection | undefined,
    options: HttpSerializationOptions,
) => {
    const page = await executeRequestPage(sdk, input);
    const regex_excerpt = resolveRegexExcerpt(input.serialization);
    const items = page.items
        .map((item) => {
            const pair = { request: item.request, response: item.response } as RequestPair;
            const preliminary = serializedEntry(sdk, pair, options, undefined);
            if (preliminary === undefined) return undefined;
            const matchContext = buildMatchContext(requestMatchSources(pair), regex_excerpt);
            return {
                cursor: String(item.cursor),
                ...preliminary,
                matchContext,
            };
        })
        .filter((item) => item !== undefined);
    return {
        pageInfo: {
            hasNextPage: page.pageInfo.hasNextPage,
            hasPreviousPage: page.pageInfo.hasPreviousPage,
            startCursor:
                page.pageInfo.startCursor === undefined ? null : String(page.pageInfo.startCursor),
            endCursor:
                page.pageInfo.endCursor === undefined ? null : String(page.pageInfo.endCursor),
        },
        items: applyProjectionToResults(items, projection),
    };
};

const parseCookieHeader = (value: string) =>
    value
        .split(";")
        .map((part) => part.trim())
        .map((part) => {
            const idx = part.indexOf("=");
            if (idx <= 0) return undefined;
            return { name: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() };
        })
        .filter((item) => item !== undefined);

const parseSetCookieHeader = (value: string) => {
    const first = value.split(";", 1)[0]?.trim() ?? "";
    if (first === "") return undefined;
    const idx = first.indexOf("=");
    if (idx <= 0) return undefined;
    return { name: first.slice(0, idx).trim(), value: first.slice(idx + 1).trim() };
};

const summarizeRequests = async (sdk: ToolContext["sdk"], input: z.infer<typeof summarySchema>) => {
    const page = await executeRequestPage(sdk, input);
    return page.items.map((item) => ({ request: item.request, response: item.response }));
};

export const registerRequestTools = ({ server, sdk, store, permissions }: ToolContext) => {
    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.requests.list",
        group: ToolGroupId.RequestSafe,
        toolName: "list_requests",
        description:
            "List saved HTTP requests with native Caido cursor pagination, HTTPQL filter, order, serialization controls, and fields/exclude_fields projection. " +
            'Example: { "limit": 50, "filter": "req.method.eq:\\"POST\\" AND resp.code.eq:200", "fields": ["cursor", "id", "request.method", "request.url", "response.status_code"] }.' +
            "\n\n" +
            HTTPQL_HELP_SHORT,
        inputSchema: listRequestsSchema,
        handler: async (params) => {
            const input = listRequestsSchema.parse(params) as ListRequestInput;
            const projection = resolveFieldProjection({
                fields: input.fields,
                excludeFields: input.exclude_fields,
                allowedPaths: HTTP_HISTORY_FIELD_PATHS,
            });
            const regexExcerptEnabled = input.serialization?.regex_excerpt !== undefined;
            validateRegexExcerptProjection(regexExcerptEnabled, projection);
            const materialization = resolveBodyMaterialization(
                input,
                projection,
                regexExcerptEnabled,
                false,
            );
            const serialization = normalizeHttpSerialization(input.serialization, materialization);
            const result = await queryRequestPage(sdk, input, projection, serialization);
            return { content: [{ type: "text", text: stringifyResult(result) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.requests.getByIds",
        group: ToolGroupId.RequestSafe,
        toolName: "get_requests_by_ids",
        description:
            "Fetch exact saved HTTP requests by ID with Burp-style lookup envelope and projection. " +
            'Example: { "ids": [1], "fields": ["request.raw", "response.raw"] }.',
        inputSchema: getRequestsSchema,
        handler: async (params) => {
            const input = getRequestsSchema.parse(params) as RequestLookupInput;
            const projection = resolveFieldProjection({
                fields: input.fields,
                excludeFields: input.exclude_fields,
                allowedPaths: HTTP_HISTORY_FIELD_PATHS,
            });
            const regexExcerptEnabled = input.serialization?.regex_excerpt !== undefined;
            validateRegexExcerptProjection(regexExcerptEnabled, projection);
            const materialization = resolveBodyMaterialization(
                input,
                projection,
                regexExcerptEnabled,
                true,
            );
            const serialization = normalizeHttpSerialization(input.serialization, materialization);
            const regex_excerpt = resolveRegexExcerpt(input.serialization);
            const results = [];
            for (const id of input.ids) {
                const pair = await sdk.requests.get(toId(id));
                if (pair?.request === undefined) {
                    results.push({ id, error: "not found" });
                    continue;
                }
                const preliminary = serializedEntry(sdk, pair, serialization, undefined);
                if (preliminary === undefined) {
                    results.push({ id, error: "not found" });
                    continue;
                }
                const matchContext = buildMatchContext(requestMatchSources(pair), regex_excerpt);
                results.push({ id, item: { ...preliminary, matchContext } });
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
        action: "sdk.requests.match",
        group: ToolGroupId.RequestSafe,
        toolName: "match_requests",
        description:
            "Check saved requests against an HTTPQL clause. " +
            'Example: { "httpql": "req.method.eq:\\"POST\\"", "ids": [1] }.' +
            "\n\n" +
            HTTPQL_HELP_SHORT,
        inputSchema: matchRequestsSchema,
        handler: async (params) => {
            const { httpql, ids } = matchRequestsSchema.parse(params);
            const validationError = await validateHttpqlClause(sdk, httpql);
            if (validationError !== null) {
                return {
                    content: [{ type: "text", text: stringifyResult({ error: validationError }) }],
                };
            }
            const results = [];
            for (const id of ids) {
                const pair = await sdk.requests.get(toId(id));
                if (pair?.request === undefined) {
                    results.push({ id, matches: false, error: "request not found" });
                    continue;
                }
                results.push({
                    id,
                    matches: sdk.requests.matches(httpql, pair.request, pair.response),
                });
            }
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.requests.send",
        group: ToolGroupId.RequestUnsafe,
        toolName: "send_requests",
        description:
            "Send saved requests by ID. " + 'Example: { "ids": [1], "options": { "save": true } }.',
        inputSchema: sendRequestsSchema,
        handler: async (params) => {
            const input = sendRequestsSchema.parse(params);
            const includeBody = input.serialization?.include_body !== false;
            const serialization = normalizeHttpSerialization(input.serialization, {
                includeHeaders: true,
                includeRequestBody: includeBody,
                includeResponseBody: includeBody,
                includeRawRequest: false,
                includeRawResponse: false,
            });
            const results = [];
            for (const id of input.ids) {
                const pair = await sdk.requests.get(toId(id));
                if (pair?.request === undefined) {
                    results.push({ ok: false, id, error: "not found" });
                    continue;
                }
                try {
                    const sent = await sdk.requests.send(
                        pair.request.toSpec(),
                        input.options ?? {},
                    );
                    results.push({
                        ok: true,
                        id,
                        result: {
                            sentRequestId: String(sent.request.getId()),
                            response: serializeHttpResponse(sent.response, serialization),
                        },
                    });
                } catch (error) {
                    results.push({
                        ok: false,
                        id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
            return { content: [{ type: "text", text: stringifyResult({ results }) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.requests.scope",
        group: ToolGroupId.RequestSafe,
        toolName: "check_requests_scope",
        description:
            "Check whether saved requests are in Caido scope. " +
            'Example: { "items": [{ "ids": [1], "scope_ids": [1] }] }.',
        inputSchema: scopeCheckSchema,
        handler: async (params) => {
            const { items } = scopeCheckSchema.parse(params);
            const results = [];
            for (const item of items) {
                const scopes = item.scope_ids?.map((id) => toId(id));
                for (const id of item.ids) {
                    const pair = await sdk.requests.get(toId(id));
                    if (pair?.request === undefined) {
                        results.push({ id, inScope: false, error: "request not found" });
                        continue;
                    }
                    results.push({
                        id,
                        inScope:
                            scopes !== undefined
                                ? sdk.requests.inScope(pair.request, scopes)
                                : sdk.requests.inScope(pair.request),
                    });
                }
            }
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.requests.summarizeCookies",
        group: ToolGroupId.RequestSafe,
        toolName: "summarize_request_cookies",
        description:
            "Aggregate Cookie and Set-Cookie observations from saved HTTP history. Supports limit/cursor/direction/order/filter.",
        inputSchema: summarySchema,
        handler: async (params) => {
            const input = summarySchema.parse(params);
            const pairs = await summarizeRequests(sdk, input);
            const byKey = new Map<
                string,
                {
                    source: string;
                    name: string;
                    valuePreview: string;
                    count: number;
                    firstSeenRequestId: number | string;
                    lastSeenRequestId: number | string;
                }
            >();
            const observe = (source: string, name: string, value: string, requestId: string) => {
                const key = `${source}::${name}`;
                const existing = byKey.get(key);
                if (existing === undefined) {
                    byKey.set(key, {
                        source,
                        name,
                        valuePreview: previewValue(value),
                        count: 1,
                        firstSeenRequestId: toNumericId(requestId),
                        lastSeenRequestId: toNumericId(requestId),
                    });
                    return;
                }
                existing.count += 1;
                existing.lastSeenRequestId = toNumericId(requestId);
            };
            for (const pair of pairs) {
                if (pair?.request === undefined) continue;
                const requestId = String(pair.request.getId());
                const headers = pair.request.getHeaders();
                for (const [name, values] of Object.entries(headers)) {
                    if (name.toLowerCase() !== "cookie") continue;
                    values.flatMap(parseCookieHeader).forEach((cookie) => {
                        observe("request_cookie", cookie.name, cookie.value, requestId);
                    });
                }
                const responseHeaders = pair.response?.getHeaders() ?? {};
                for (const [name, values] of Object.entries(responseHeaders)) {
                    if (name.toLowerCase() !== "set-cookie") continue;
                    values.map(parseSetCookieHeader).forEach((cookie) => {
                        if (cookie === undefined) return;
                        observe("response_set_cookie", cookie.name, cookie.value, requestId);
                    });
                }
            }
            const observations = Array.from(byKey.values()).sort(
                (a, b) => b.count - a.count || a.name.localeCompare(b.name),
            );
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            totalEntriesScanned: pairs.length,
                            uniqueCookies: observations.length,
                            observations,
                        }),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.requests.summarizeAuthHeaders",
        group: ToolGroupId.RequestSafe,
        toolName: "summarize_request_auth_headers",
        description:
            "Aggregate likely authentication headers from saved HTTP history. Supports limit/cursor/direction/order/filter.",
        inputSchema: summarySchema,
        handler: async (params) => {
            const input = summarySchema.parse(params);
            const pairs = await summarizeRequests(sdk, input);
            const byHeader = new Map<
                string,
                {
                    header: string;
                    valuePreview: string;
                    count: number;
                    firstSeenRequestId: number | string;
                    lastSeenRequestId: number | string;
                }
            >();
            const observe = (header: string, value: string, requestId: string) => {
                const key = header.toLowerCase();
                const existing = byHeader.get(key);
                if (existing === undefined) {
                    byHeader.set(key, {
                        header,
                        valuePreview: previewValue(value),
                        count: 1,
                        firstSeenRequestId: toNumericId(requestId),
                        lastSeenRequestId: toNumericId(requestId),
                    });
                    return;
                }
                existing.count += 1;
                existing.lastSeenRequestId = toNumericId(requestId);
            };
            for (const pair of pairs) {
                if (pair?.request === undefined) continue;
                const requestId = String(pair.request.getId());
                for (const [name, values] of Object.entries(pair.request.getHeaders())) {
                    const lower = name.toLowerCase();
                    const likely =
                        lower === "authorization" ||
                        lower === "proxy-authorization" ||
                        lower === "x-api-key" ||
                        lower === "api-key" ||
                        lower.includes("auth") ||
                        lower.includes("token");
                    if (!likely) continue;
                    values.forEach((value) => observe(name, value, requestId));
                }
            }
            const observations = Array.from(byHeader.values()).sort(
                (a, b) => b.count - a.count || a.header.localeCompare(b.header),
            );
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            totalEntriesScanned: pairs.length,
                            uniqueHeaders: observations.length,
                            observations,
                        }),
                    },
                ],
            };
        },
    });
};
