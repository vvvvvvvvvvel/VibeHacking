export type IdDirection = "increasing" | "decreasing";

export type BodyEncoding = "text" | "base64" | "omitted";

export type TextOverflowMode = "truncate" | "omit";

export type MessageBodyView = {
    encoding: BodyEncoding;
    size: number;
    truncated?: boolean;
    text?: string;
    base64?: string;
    omittedReason?: string;
};

export type RegexExcerptInput = {
    context_chars?: number;
    regex?: string;
};

export type MatchContext = {
    excerpts: Array<{
        path: string;
        text: string;
    }>;
};

export type ProjectedHttpSerializationOptionsInput = {
    include_body?: boolean;
    include_binary?: boolean;
    max_text_body_chars?: number;
    max_request_body_chars?: number;
    max_response_body_chars?: number;
    text_overflow_mode?: TextOverflowMode;
    max_binary_body_bytes?: number;
    regex_excerpt?: RegexExcerptInput;
};

export type HttpSerializationOptions = {
    includeHeaders: boolean;
    includeRequestBody: boolean;
    includeResponseBody: boolean;
    includeRawRequest: boolean;
    includeRawResponse: boolean;
    includeBinary: boolean;
    maxRequestBodyChars: number;
    maxResponseBodyChars: number;
    maxRawBodyChars: number;
    textOverflowMode: TextOverflowMode;
    maxBinaryBodyBytes: number;
};

export type WebSocketSerializationOptionsInput = {
    include_binary?: boolean;
    include_edited_payload?: boolean;
    max_text_payload_chars?: number;
    max_binary_payload_bytes?: number;
};

export type WebSocketSerializationOptions = {
    includeBinary: boolean;
    includeEditedPayload: boolean;
    maxTextPayloadChars: number;
    maxBinaryPayloadBytes: number;
};

export type SerializedHttpRequest = {
    id?: number | string;
    method: string;
    url: string;
    path: string;
    query?: string;
    host: string;
    port: number;
    secure: boolean;
    inScope?: boolean;
    createdAt?: string;
    headers?: Record<string, string[]>;
    body?: MessageBodyView;
    raw?: MessageBodyView;
};

export type SerializedHttpResponse = {
    id?: number | string;
    statusCode: number;
    reasonPhrase?: string;
    mimeType?: string;
    headers?: Record<string, string[]>;
    cookies?: Array<{ name: string; value: string }>;
    body?: MessageBodyView;
    raw?: MessageBodyView;
    createdAt?: string;
};

export type SerializedHttpHistoryEntry = {
    id: number | string;
    time: string;
    inScope?: boolean;
    request: SerializedHttpRequest;
    response?: SerializedHttpResponse;
    matchContext?: MatchContext;
};

export type SerializedWebSocketMessage = {
    id: number | string;
    streamId?: number | string;
    headId?: number | string;
    editIds?: Array<number | string>;
    time: string;
    direction: string;
    alteration?: string;
    format?: string;
    length: number;
    payload: MessageBodyView;
    editedPayload?: MessageBodyView;
    stream?: {
        id: number | string;
        host: string;
        port: number;
        path: string;
        secure: boolean;
        direction: string;
        source: string;
        protocol: string;
        createdAt: string;
    };
};

export type FieldProjection = {
    fields?: Set<string>;
    excludeFields?: Set<string>;
};

export type HttpMaterialization = {
    includeHeaders: boolean;
    includeRequestBody: boolean;
    includeResponseBody: boolean;
    includeRawRequest: boolean;
    includeRawResponse: boolean;
};
