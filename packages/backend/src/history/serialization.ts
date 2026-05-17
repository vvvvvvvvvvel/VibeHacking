import { Buffer } from "buffer";

import type { Request, Response } from "caido:utils";

import { toNumericId } from "../mcp-tools/shared";

import type {
    HttpMaterialization,
    HttpSerializationOptions,
    MessageBodyView,
    ProjectedHttpSerializationOptionsInput,
    SerializedHttpRequest,
    SerializedHttpResponse,
    TextOverflowMode,
    WebSocketSerializationOptions,
    WebSocketSerializationOptionsInput,
} from "./types";

export const DEFAULT_MAX_TEXT_BODY_CHARS = 1024;
export const DEFAULT_MAX_BINARY_BODY_BYTES = 65536;
export const DEFAULT_MAX_TEXT_PAYLOAD_CHARS = 4000;

const textContentTypes = [
    "text/",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-www-form-urlencoded",
    "application/graphql",
    "application/soap+xml",
    "application/x-ndjson",
];

const headerValue = (headers: Record<string, string[]>, name: string) => {
    const lower = name.toLowerCase();
    for (const [key, values] of Object.entries(headers)) {
        if (key.toLowerCase() === lower) return values[0];
    }
    return undefined;
};

const headerValues = (headers: Record<string, string[]>, name: string) => {
    const lower = name.toLowerCase();
    const out: string[] = [];
    for (const [key, values] of Object.entries(headers)) {
        if (key.toLowerCase() === lower) out.push(...values);
    }
    return out;
};

const isLikelyTextContentType = (contentType?: string) => {
    if (contentType === undefined || contentType.trim() === "") return false;
    const lowered = contentType.toLowerCase();
    return (
        textContentTypes.some((prefix) => lowered.startsWith(prefix)) ||
        lowered.includes("+json") ||
        lowered.includes("+xml")
    );
};

export const isLikelyBinaryPayload = (bytes: Uint8Array) => {
    if (bytes.byteLength === 0) return false;
    const sampleSize = Math.min(bytes.byteLength, 512);
    let suspicious = 0;
    for (let i = 0; i < sampleSize; i += 1) {
        const value = bytes[i] ?? 0;
        if (value === 0) return true;
        const allowedControl = value === 9 || value === 10 || value === 13;
        if (value < 32 && !allowedControl) suspicious += 1;
    }
    return (suspicious * 100) / sampleSize >= 12;
};

export const serializeBytes = ({
    bytes,
    contentType,
    includeBinary,
    maxTextChars,
    textOverflowMode = "truncate",
    maxBinaryBytes,
}: {
    bytes: Uint8Array;
    contentType?: string;
    includeBinary: boolean;
    maxTextChars: number;
    textOverflowMode?: TextOverflowMode;
    maxBinaryBytes: number;
}): MessageBodyView => {
    if (bytes.byteLength === 0) {
        return { encoding: "text", size: 0, text: "" };
    }

    const textLike =
        contentType === undefined || contentType.trim() === ""
            ? !isLikelyBinaryPayload(bytes)
            : isLikelyTextContentType(contentType);

    if (textLike) {
        const text = Buffer.from(bytes).toString("utf8");
        if (maxTextChars > 0 && text.length > maxTextChars) {
            if (textOverflowMode === "omit") {
                return {
                    encoding: "omitted",
                    size: bytes.byteLength,
                    omittedReason: "text body omitted (exceeds max chars limit)",
                };
            }
            return {
                encoding: "text",
                size: bytes.byteLength,
                truncated: true,
                text: text.slice(0, maxTextChars),
            };
        }
        return { encoding: "text", size: bytes.byteLength, text };
    }

    if (!includeBinary) {
        return {
            encoding: "omitted",
            size: bytes.byteLength,
            omittedReason: "binary body omitted (includeBinary=false)",
        };
    }

    if (maxBinaryBytes > 0 && bytes.byteLength > maxBinaryBytes) {
        return {
            encoding: "omitted",
            size: bytes.byteLength,
            omittedReason: "binary body omitted (exceeds maxBinaryBodyBytes)",
        };
    }

    return {
        encoding: "base64",
        size: bytes.byteLength,
        base64: Buffer.from(bytes).toString("base64"),
    };
};

export const normalizeHttpSerialization = (
    input: ProjectedHttpSerializationOptionsInput | undefined,
    materialization: HttpMaterialization,
): HttpSerializationOptions => {
    const maxTextBodyChars = Math.max(0, input?.max_text_body_chars ?? DEFAULT_MAX_TEXT_BODY_CHARS);
    const maxRequestBodyChars = Math.max(0, input?.max_request_body_chars ?? maxTextBodyChars);
    const maxResponseBodyChars = Math.max(0, input?.max_response_body_chars ?? maxTextBodyChars);
    return {
        includeHeaders: materialization.includeHeaders,
        includeRequestBody: materialization.includeRequestBody,
        includeResponseBody: materialization.includeResponseBody,
        includeRawRequest: materialization.includeRawRequest,
        includeRawResponse: materialization.includeRawResponse,
        includeBinary: input?.include_binary === true,
        maxRequestBodyChars,
        maxResponseBodyChars,
        maxRawBodyChars: Math.max(maxRequestBodyChars, maxResponseBodyChars),
        textOverflowMode: input?.text_overflow_mode ?? "omit",
        maxBinaryBodyBytes: Math.max(
            0,
            input?.max_binary_body_bytes ?? DEFAULT_MAX_BINARY_BODY_BYTES,
        ),
    };
};

export const normalizeWebSocketSerialization = (
    input?: WebSocketSerializationOptionsInput,
): WebSocketSerializationOptions => ({
    includeBinary: input?.include_binary === true,
    includeEditedPayload: input?.include_edited_payload === true,
    maxTextPayloadChars: Math.max(
        0,
        input?.max_text_payload_chars ?? DEFAULT_MAX_TEXT_PAYLOAD_CHARS,
    ),
    maxBinaryPayloadBytes: Math.max(
        0,
        input?.max_binary_payload_bytes ?? DEFAULT_MAX_BINARY_BODY_BYTES,
    ),
});

const rawBytes = (
    value: { toRaw?: () => Uint8Array; toText?: () => string } | undefined,
): Uint8Array => {
    const bytes = value?.toRaw?.();
    if (bytes !== undefined) return bytes;
    const text = value?.toText?.();
    return text !== undefined ? Buffer.from(text, "utf8") : new Uint8Array();
};

const parseUrlParts = (url: string, fallbackHost: string, fallbackPort: number) => {
    try {
        const parsed = new URL(url);
        return {
            path: parsed.pathname,
            query: parsed.search.length > 1 ? parsed.search.slice(1) : undefined,
            secure: parsed.protocol === "https:",
            port:
                parsed.port !== "" ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
            host: parsed.hostname || fallbackHost,
        };
    } catch {
        return {
            path: url,
            query: undefined,
            secure: fallbackPort === 443,
            port: fallbackPort,
            host: fallbackHost,
        };
    }
};

export const serializeHttpRequest = (
    request: Request,
    options: HttpSerializationOptions,
): SerializedHttpRequest => {
    const headers = request.getHeaders();
    const body = request.getBody();
    const raw = request.getRaw();
    const url = request.getUrl();
    const parts = parseUrlParts(url, request.getHost(), request.getPort());
    const bodyBytes = rawBytes(body ?? undefined);
    const rawRequestBytes = rawBytes(raw ?? undefined);
    const contentType = headerValue(headers, "content-type");
    const result: SerializedHttpRequest = {
        id: toNumericId(String(request.getId())),
        method: request.getMethod(),
        url,
        path: parts.path,
        query: parts.query,
        host: parts.host,
        port: parts.port,
        secure: parts.secure,
        createdAt: request.getCreatedAt().toISOString(),
    };
    if (options.includeHeaders) result.headers = headers;
    if (options.includeRequestBody) {
        result.body = serializeBytes({
            bytes: bodyBytes,
            contentType,
            includeBinary: options.includeBinary,
            maxTextChars: options.maxRequestBodyChars,
            textOverflowMode: options.textOverflowMode,
            maxBinaryBytes: options.maxBinaryBodyBytes,
        });
    }
    if (options.includeRawRequest) {
        result.raw = serializeBytes({
            bytes: rawRequestBytes,
            contentType: "text/plain",
            includeBinary: true,
            maxTextChars: options.maxRawBodyChars,
            textOverflowMode: "truncate",
            maxBinaryBytes: Number.MAX_SAFE_INTEGER,
        });
    }
    return result;
};

const parseSetCookie = (value: string): { name: string; value: string } | undefined => {
    const first = value.split(";", 1)[0];
    if (first === undefined || first.trim() === "") return undefined;
    const idx = first.indexOf("=");
    if (idx <= 0) return undefined;
    return {
        name: first.slice(0, idx).trim(),
        value: first.slice(idx + 1).trim(),
    };
};

export const serializeHttpResponse = (
    response: Response | undefined,
    options: HttpSerializationOptions,
): SerializedHttpResponse | undefined => {
    if (response === undefined) return undefined;
    const headers = response.getHeaders();
    const body = response.getBody();
    const raw = response.getRaw();
    const bodyBytes = rawBytes(body ?? undefined);
    const rawResponseBytes = rawBytes(raw ?? undefined);
    const contentType = headerValue(headers, "content-type");
    const cookies = options.includeHeaders
        ? headerValues(headers, "set-cookie")
              .map(parseSetCookie)
              .filter((item) => item !== undefined)
        : [];
    const mimeType = contentType?.split(";", 1)[0]?.trim();
    const result: SerializedHttpResponse = {
        id: toNumericId(String(response.getId())),
        statusCode: response.getCode(),
        mimeType: mimeType !== "" ? mimeType : undefined,
        createdAt: response.getCreatedAt().toISOString(),
    };
    if (options.includeHeaders) {
        result.headers = headers;
        result.cookies = cookies;
    }
    if (options.includeResponseBody) {
        result.body = serializeBytes({
            bytes: bodyBytes,
            contentType,
            includeBinary: options.includeBinary,
            maxTextChars: options.maxResponseBodyChars,
            textOverflowMode: options.textOverflowMode,
            maxBinaryBytes: options.maxBinaryBodyBytes,
        });
    }
    if (options.includeRawResponse) {
        result.raw = serializeBytes({
            bytes: rawResponseBytes,
            contentType: "text/plain",
            includeBinary: true,
            maxTextChars: options.maxRawBodyChars,
            textOverflowMode: "truncate",
            maxBinaryBytes: Number.MAX_SAFE_INTEGER,
        });
    }
    return result;
};

export const previewValue = (value: string, maxChars = 120) => {
    const trimmed = value.trim();
    return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}...`;
};
