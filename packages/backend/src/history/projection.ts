import { toWireValue } from "../mcp-tools/shared";

import type { FieldProjection, HttpMaterialization } from "./types";

const fieldPathPattern = /^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/;

export const HTTP_HISTORY_FIELD_PATHS = new Set([
    "cursor",
    "id",
    "time",
    "in_scope",
    "request",
    "request.id",
    "request.method",
    "request.url",
    "request.path",
    "request.query",
    "request.host",
    "request.port",
    "request.secure",
    "request.in_scope",
    "request.created_at",
    "request.headers",
    "request.body",
    "request.body.encoding",
    "request.body.size",
    "request.body.truncated",
    "request.body.text",
    "request.body.base64",
    "request.body.omitted_reason",
    "request.raw",
    "request.raw.encoding",
    "request.raw.size",
    "request.raw.truncated",
    "request.raw.text",
    "request.raw.base64",
    "request.raw.omitted_reason",
    "response",
    "response.id",
    "response.status_code",
    "response.reason_phrase",
    "response.mime_type",
    "response.headers",
    "response.cookies",
    "response.body",
    "response.body.encoding",
    "response.body.size",
    "response.body.truncated",
    "response.body.text",
    "response.body.base64",
    "response.body.omitted_reason",
    "response.raw",
    "response.raw.encoding",
    "response.raw.size",
    "response.raw.truncated",
    "response.raw.text",
    "response.raw.base64",
    "response.raw.omitted_reason",
    "response.created_at",
    "match_context",
    "match_context.excerpts",
    "match_context.excerpts.path",
    "match_context.excerpts.text",
]);

export const WS_MESSAGE_FIELD_PATHS = new Set([
    "cursor",
    "id",
    "stream_id",
    "head_id",
    "edit_ids",
    "time",
    "direction",
    "alteration",
    "format",
    "length",
    "payload",
    "payload.encoding",
    "payload.size",
    "payload.truncated",
    "payload.text",
    "payload.base64",
    "payload.omitted_reason",
    "edited_payload",
    "edited_payload.encoding",
    "edited_payload.size",
    "edited_payload.truncated",
    "edited_payload.text",
    "edited_payload.base64",
    "edited_payload.omitted_reason",
    "stream",
    "stream.id",
    "stream.host",
    "stream.port",
    "stream.path",
    "stream.secure",
    "stream.direction",
    "stream.source",
    "stream.protocol",
    "stream.created_at",
]);

const normalizePathSet = (
    values: string[] | undefined,
    name: string,
    allowedPaths: Set<string>,
) => {
    if (values === undefined || values === null) return undefined;
    const normalized = Array.from(
        new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
    );
    if (normalized.length === 0) return undefined;
    for (const path of normalized) {
        if (!fieldPathPattern.test(path)) {
            throw new Error(`${name} contains invalid path '${path}'`);
        }
        if (!allowedPaths.has(path)) {
            throw new Error(`${name} contains unsupported path '${path}'`);
        }
    }
    return new Set(normalized);
};

export const resolveFieldProjection = ({
    fields,
    excludeFields,
    allowedPaths,
}: {
    fields?: string[];
    excludeFields?: string[];
    allowedPaths: Set<string>;
}): FieldProjection | undefined => {
    const normalizedFields = normalizePathSet(fields, "fields", allowedPaths);
    const normalizedExcludeFields = normalizePathSet(excludeFields, "exclude_fields", allowedPaths);
    if (normalizedFields !== undefined && normalizedExcludeFields !== undefined) {
        throw new Error("only one of fields or exclude_fields may be non-null");
    }
    if (normalizedFields !== undefined) return { fields: normalizedFields };
    if (normalizedExcludeFields !== undefined) return { excludeFields: normalizedExcludeFields };
    return undefined;
};

const hasPathWithPrefix = (paths: Set<string> | undefined, prefix: string) => {
    if (paths === undefined) return false;
    for (const path of paths) {
        if (path === prefix || path.startsWith(`${prefix}.`)) return true;
    }
    return false;
};

export const resolveHttpMaterialization = (
    projection: FieldProjection | undefined,
    regexExcerptEnabled: boolean,
): HttpMaterialization => {
    if (projection?.fields !== undefined) {
        const requestParent = projection.fields.has("request");
        const responseParent = projection.fields.has("response");
        return {
            includeHeaders:
                requestParent ||
                responseParent ||
                hasPathWithPrefix(projection.fields, "request.headers") ||
                hasPathWithPrefix(projection.fields, "response.headers") ||
                hasPathWithPrefix(projection.fields, "response.cookies"),
            includeRequestBody:
                !regexExcerptEnabled &&
                (requestParent || hasPathWithPrefix(projection.fields, "request.body")),
            includeResponseBody:
                !regexExcerptEnabled &&
                (responseParent || hasPathWithPrefix(projection.fields, "response.body")),
            includeRawRequest:
                !regexExcerptEnabled && hasPathWithPrefix(projection.fields, "request.raw"),
            includeRawResponse:
                !regexExcerptEnabled && hasPathWithPrefix(projection.fields, "response.raw"),
        };
    }

    return {
        includeHeaders: true,
        includeRequestBody: !regexExcerptEnabled,
        includeResponseBody: !regexExcerptEnabled,
        includeRawRequest: false,
        includeRawResponse: false,
    };
};

const includePath = (
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    segments: string[],
) => {
    const [head, ...tail] = segments;
    if (head === undefined || !(head in source)) return;
    const value = source[head];
    if (tail.length === 0) {
        target[head] = mergeValue(target[head], value);
        return;
    }
    if (Array.isArray(value)) {
        const existingItems = Array.isArray(target[head]) ? target[head] : [];
        target[head] = value.map((item, index) => {
            if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
            const existing = existingItems[index];
            const nested =
                existing !== null && typeof existing === "object" && !Array.isArray(existing)
                    ? { ...(existing as Record<string, unknown>) }
                    : {};
            includePath(item as Record<string, unknown>, nested, tail);
            return nested;
        });
        return;
    }
    if (value === null || typeof value !== "object") return;
    const nested =
        target[head] !== null && typeof target[head] === "object" && !Array.isArray(target[head])
            ? ({ ...(target[head] as Record<string, unknown>) } as Record<string, unknown>)
            : {};
    includePath(value as Record<string, unknown>, nested, tail);
    if (Object.keys(nested).length > 0) target[head] = nested;
};

const mergeValue = (existing: unknown, incoming: unknown): unknown => {
    if (
        existing !== null &&
        incoming !== null &&
        typeof existing === "object" &&
        typeof incoming === "object" &&
        !Array.isArray(existing) &&
        !Array.isArray(incoming)
    ) {
        return {
            ...(existing as Record<string, unknown>),
            ...(incoming as Record<string, unknown>),
        };
    }
    return incoming;
};

const removePath = (source: unknown, segments: string[]): unknown => {
    if (source === null || typeof source !== "object") return source;
    if (Array.isArray(source)) return source.map((item) => removePath(item, segments));
    const [head, ...tail] = segments;
    if (head === undefined) return source;
    const out = { ...(source as Record<string, unknown>) };
    if (tail.length === 0) {
        delete out[head];
        return out;
    }
    if (head in out) out[head] = removePath(out[head], tail);
    return out;
};

export const applyProjectionToItem = <T>(item: T, projection: FieldProjection | undefined): T => {
    const wireItem = toWireValue(item);
    const optimized = optimizeDefaultHttpShape(wireItem);
    if (projection === undefined) return optimized as T;
    if (projection.fields !== undefined) {
        const source = wireItem as Record<string, unknown>;
        const target: Record<string, unknown> = {};
        for (const path of projection.fields) includePath(source, target, path.split("."));
        return target as T;
    }
    if (projection.excludeFields !== undefined) {
        let current: unknown = optimized;
        for (const path of Array.from(projection.excludeFields).sort(
            (a, b) => b.split(".").length - a.split(".").length,
        )) {
            current = removePath(current, path.split("."));
        }
        return current as T;
    }
    return optimized as T;
};

export const applyProjectionToResults = <T>(
    results: T[],
    projection: FieldProjection | undefined,
): T[] => results.map((item) => applyProjectionToItem(item, projection));

export const applyProjectionToLookupResults = <T extends { item?: unknown }>(
    results: T[],
    projection: FieldProjection | undefined,
): T[] =>
    results.map((wrapper) => {
        if (wrapper.item === undefined || wrapper.item === null) return wrapper;
        return {
            ...wrapper,
            item: applyProjectionToItem(wrapper.item, projection),
        };
    });

const optimizeDefaultHttpShape = (item: unknown): unknown => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
    const out = { ...(item as Record<string, unknown>) };
    delete out.in_scope;
    if (out.request !== null && typeof out.request === "object" && !Array.isArray(out.request)) {
        const request = { ...(out.request as Record<string, unknown>) };
        delete request.path;
        delete request.query;
        delete request.in_scope;
        out.request = request;
    }
    if (out.response !== null && typeof out.response === "object" && !Array.isArray(out.response)) {
        const response = { ...(out.response as Record<string, unknown>) };
        if (Array.isArray(response.cookies) && response.cookies.length === 0) {
            delete response.cookies;
        }
        out.response = response;
    }
    return out;
};

const regexExcerptIgnoredFieldPrefixes = [
    "request.body",
    "response.body",
    "request.raw",
    "response.raw",
];

const isRegexExcerptIgnoredField = (path: string) =>
    regexExcerptIgnoredFieldPrefixes.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}.`),
    );

export const normalizeRegexExcerptProjection = (
    regexExcerptEnabled: boolean,
    projection: FieldProjection | undefined,
): FieldProjection | undefined => {
    if (!regexExcerptEnabled || projection?.fields === undefined) return projection;
    return {
        fields: new Set(
            Array.from(projection.fields).filter((path) => !isRegexExcerptIgnoredField(path)),
        ),
    };
};
