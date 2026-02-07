import { Buffer } from "buffer";

import type { Cursor, DedupeKey, ID, Request, Response } from "caido:utils";

export type ActionPayload = {
    action: string;
    params: Record<string, unknown>;
};

export type ToolResult = {
    content: { type: "text"; text: string }[];
};

export const HTTPQL_HELP_SHORT = [
    "HTTPQL examples (Caido):",
    'req.method.eq:"POST"',
    'req.path.cont:"/api/" AND (req.method.eq:"POST" OR req.method.eq:"PUT")',
    "resp.code.eq:200",
    "Use tool: get-httpql-help for more.",
].join("\n");

export const HTTPQL_HELP_PROMPT = [
    HTTPQL_HELP_SHORT,
    "",
    "Syntax notes:",
    "Use req.* for request fields, resp.* for response fields, and row.* for table rows.",
    "Combine clauses with AND / OR and parentheses.",
    "req fields: ext (file extension, includes dot), host, method, path, port, raw, created_at.",
    "resp fields: code, raw, roundtrip (ms), ext.",
    "row fields: id.",
    "Operators: eq/ne for exact match; cont/ncont for contains; gt/gte/lt/lte for numbers/dates; regex/nregex for text.",
    "Notes: cont/ncont are case-insensitive; LIKE supports % and _. Some regex features are unsupported.",
    "created_at formats: RFC3339, ISO 8601, RFC2822, RFC7231, ISO9075.",
    'Example: req.host.eq:"example.com" AND (req.path.cont:"/api/" OR req.created_at.gt:"2025-02-02T01:02:03+00:00")',
    "Docs: https://docs.caido.io/reference/httpql",
    "Guide: https://docs.caido.io/app/guides/filters_httpql",
].join("\n");

type HttpqlQueryChain = {
    filter: (clause: string) => HttpqlQueryChain;
    first: (n: number) => HttpqlQueryChain;
    execute: () => Promise<unknown>;
};

export const validateHttpqlClause = async (
    sdk: {
        requests: {
            query: () => HttpqlQueryChain;
        };
    },
    clause: string,
) => {
    try {
        await sdk.requests.query().filter(clause).first(1).execute();
        return null;
    } catch (error) {
        return {
            code: "INVALID_HTTPQL",
            message: error instanceof Error ? error.message : String(error),
        };
    }
};

export type SerializationOptions = {
    includeBody?: boolean;
    includeBinary?: boolean;
    maxBinaryBytes?: number;
};

const DEFAULT_MAX_BINARY_BYTES = 65536;
const formatBinaryPlaceholder = (size: number) => `<...binary data ${size} bytes...>`;

export type SerializedRequest = {
    id: number | string;
    host: string;
    port: number;
    method: string;
    fullUrl: string;
    headers: Record<string, string[]>;
    body: string | undefined;
    bodyBase64?: string;
    bodyEncoding?: "text" | "base64" | "omitted";
    createdAt: string;
    raw: string | undefined;
    cursor?: string;
};

export type SerializedResponse = {
    id: number | string;
    code: number;
    headers: Record<string, string[]>;
    body: string | undefined;
    bodyBase64?: string;
    bodyEncoding?: "text" | "base64" | "omitted";
    createdAt: string;
    raw: string | undefined;
    cursor?: string;
};

const textContentTypes = [
    "text/",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-www-form-urlencoded",
];

const isLikelyText = (contentType: string | undefined) => {
    if (contentType === undefined || contentType === "") return true;
    const lowered = contentType.toLowerCase();
    return textContentTypes.some((prefix) => lowered.startsWith(prefix));
};

const normalizeSerializationOptions = (options?: SerializationOptions) => {
    const includeBinary = options?.includeBinary === true;
    const maxBinaryBytes =
        options?.maxBinaryBytes !== undefined
            ? Math.max(0, options.maxBinaryBytes)
            : DEFAULT_MAX_BINARY_BYTES;
    return { includeBinary, maxBinaryBytes };
};

const serializeBody = (
    body: { toText: () => string; toRaw: () => Uint8Array } | undefined,
    headers: Record<string, string[]>,
    options?: SerializationOptions,
) => {
    if (body === undefined) return { body: undefined } as const;
    const contentType = headers["content-type"]?.[0] ?? headers["Content-Type"]?.[0];
    if (isLikelyText(contentType)) {
        const text = body.toText();
        return { body: text, bodyEncoding: "text" } as const;
    }
    const { includeBinary, maxBinaryBytes } = normalizeSerializationOptions(options);
    const rawBytes = body.toRaw();
    const contentLengthHeader = headers["content-length"]?.[0] ?? headers["Content-Length"]?.[0];
    const contentLength =
        contentLengthHeader !== undefined && contentLengthHeader !== ""
            ? Number(contentLengthHeader)
            : NaN;
    const binarySize = Number.isFinite(contentLength) ? contentLength : rawBytes.byteLength;
    if (!includeBinary || binarySize > maxBinaryBytes) {
        return {
            body: undefined,
            bodyBase64: formatBinaryPlaceholder(binarySize),
            bodyEncoding: "omitted",
        } as const;
    }
    const base64 = Buffer.from(rawBytes).toString("base64");
    return { body: undefined, bodyBase64: base64, bodyEncoding: "base64" } as const;
};

const maskRawBody = (rawText: string, placeholder: string) => {
    const separator = "\r\n\r\n";
    const altSeparator = "\n\n";
    if (rawText.includes(separator)) {
        const [head] = rawText.split(separator, 1);
        return `${head}${separator}${placeholder}`;
    }
    if (rawText.includes(altSeparator)) {
        const [head] = rawText.split(altSeparator, 1);
        return `${head}${altSeparator}${placeholder}`;
    }
    return placeholder;
};

const serializeRaw = (
    raw: { toText: () => string } | undefined,
    headers: Record<string, string[]>,
    body: { toRaw: () => Uint8Array } | undefined,
    options?: SerializationOptions,
) => {
    if (raw === undefined) return undefined;
    const contentType = headers["content-type"]?.[0] ?? headers["Content-Type"]?.[0];
    const rawBytes = body?.toRaw?.();
    const contentLengthHeader = headers["content-length"]?.[0] ?? headers["Content-Length"]?.[0];
    const contentLength =
        contentLengthHeader !== undefined && contentLengthHeader !== ""
            ? Number(contentLengthHeader)
            : NaN;
    const binarySize = Number.isFinite(contentLength)
        ? contentLength
        : rawBytes !== undefined
          ? rawBytes.byteLength
          : 0;
    const { includeBinary, maxBinaryBytes } = normalizeSerializationOptions(options);
    const shouldHideRaw =
        !isLikelyText(contentType) && (!includeBinary || binarySize > maxBinaryBytes);
    const rawText = raw.toText();
    if (!shouldHideRaw) return rawText;
    return maskRawBody(rawText, formatBinaryPlaceholder(binarySize));
};

export const serializeRequest = (
    request: Request,
    options?: SerializationOptions,
): SerializedRequest => {
    const includeBody = options?.includeBody !== false;
    const body = request.getBody();
    const raw = request.getRaw();
    const headers = request.getHeaders();
    const serializedBody = includeBody ? serializeBody(body, headers, options) : undefined;
    return {
        id: toNumericId(String(request.getId())),
        host: request.getHost(),
        port: request.getPort(),
        method: request.getMethod(),
        fullUrl: request.getUrl(),
        headers,
        body: serializedBody?.body,
        bodyBase64: serializedBody?.bodyBase64,
        bodyEncoding: includeBody ? serializedBody?.bodyEncoding : "omitted",
        createdAt: request.getCreatedAt().toISOString(),
        raw: includeBody
            ? serializeRaw(raw ?? undefined, headers, body ?? undefined, options)
            : undefined,
    };
};

export const serializeResponse = (
    response?: Response,
    options?: SerializationOptions,
): SerializedResponse | undefined => {
    if (response === undefined) return undefined;
    const includeBody = options?.includeBody !== false;
    const body = response.getBody();
    const raw = response.getRaw();
    const headers = response.getHeaders();
    const serializedBody = includeBody ? serializeBody(body, headers, options) : undefined;
    return {
        id: toNumericId(String(response.getId())),
        code: response.getCode(),
        headers,
        body: serializedBody?.body,
        bodyBase64: serializedBody?.bodyBase64,
        bodyEncoding: includeBody ? serializedBody?.bodyEncoding : "omitted",
        createdAt: response.getCreatedAt().toISOString(),
        raw: includeBody
            ? serializeRaw(raw ?? undefined, headers, body ?? undefined, options)
            : undefined,
    };
};

export const toNumericId = (value: string | number): number | string => {
    if (typeof value === "number") return value;
    const trimmed = value.trim();
    return /^[0-9]+$/.test(trimmed) ? Number(trimmed) : value;
};

export const coerceNumericIds = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map((item) => coerceNumericIds(item));
    }
    if (value !== null && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        const result: Record<string, unknown> = {};
        const nullKeys = new Set([
            "body",
            "raw",
            "bodyBase64",
            "rawBase64",
            "rawUtf8",
            "requestRawBase64",
            "requestRawUtf8",
            "responseRawBase64",
            "responseRawUtf8",
        ]);
        for (const [key, val] of entries) {
            if (val === undefined) {
                if (nullKeys.has(key)) {
                    result[key] = null;
                }
                continue;
            }
            if (key === "cursor" || key === "startCursor" || key === "endCursor") {
                result[key] = val;
                continue;
            }
            if (/^(id|.*Id|.*Ids)$/.test(key)) {
                if (Array.isArray(val)) {
                    result[key] = val.map((item) =>
                        typeof item === "string" ? toNumericId(item) : item,
                    );
                } else if (typeof val === "string") {
                    result[key] = toNumericId(val);
                } else {
                    result[key] = val;
                }
                continue;
            }
            result[key] = coerceNumericIds(val);
        }
        return result;
    }
    return value;
};

export const stringifyResult = (value: unknown): string => JSON.stringify(coerceNumericIds(value));

export const toId = (value: string): ID => value as unknown as ID;
export const toDedupeKey = (value: string): DedupeKey => value as unknown as DedupeKey;
export const toCursor = (value: string): Cursor => value as unknown as Cursor;

export const isToolResult = (value: unknown): value is ToolResult => {
    if (value === null || value === undefined || typeof value !== "object") return false;
    const content = (value as ToolResult).content;
    return (
        Array.isArray(content) &&
        content.every(
            (item) =>
                item !== null &&
                typeof item === "object" &&
                (item as { type?: unknown }).type === "text" &&
                typeof (item as { text?: unknown }).text === "string",
        )
    );
};

export const formatDetails = ({ params }: ActionPayload) => {
    if (params === undefined || Object.keys(params).length === 0) return "";
    const safeParams = JSON.stringify(params);
    return `Params:\n${safeParams}`;
};
