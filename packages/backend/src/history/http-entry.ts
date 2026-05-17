import type { Request, Response } from "caido:utils";

import { toNumericId } from "../mcp-tools/shared";

import { resolveHttpMaterialization } from "./projection";
import { buildMatchContext, type RegexExcerptConfig } from "./regex-excerpt";
import { serializeHttpRequest, serializeHttpResponse } from "./serialization";
import type {
    FieldProjection,
    HttpSerializationOptions,
    MatchContext,
    ProjectedHttpSerializationOptionsInput,
    SerializedHttpHistoryEntry,
} from "./types";

export type HttpPairLike =
    | {
          request?: Request;
          response?: Response;
      }
    | undefined;

export type SerializedHttpHistoryListEntry = SerializedHttpHistoryEntry & {
    cursor?: string;
};

const bodyText = (body?: { toText?: () => string }) => {
    try {
        return body?.toText?.();
    } catch {
        return undefined;
    }
};

export const httpPairMatchSources = (pair: HttpPairLike) => {
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

export const buildHttpMatchContext = (
    pair: HttpPairLike,
    regexExcerpt: RegexExcerptConfig | undefined,
) => buildMatchContext(httpPairMatchSources(pair), regexExcerpt);

export const serializeHttpHistoryEntry = ({
    pair,
    options,
    matchContext,
    inScope,
    cursor,
}: {
    pair: HttpPairLike;
    options: HttpSerializationOptions;
    matchContext: MatchContext | undefined;
    inScope?: boolean;
    cursor?: string;
}): SerializedHttpHistoryListEntry | undefined => {
    if (pair?.request === undefined) return undefined;
    const entry: SerializedHttpHistoryEntry = {
        id: toNumericId(String(pair.request.getId())),
        time: pair.request.getCreatedAt().toISOString(),
        inScope,
        request: { ...serializeHttpRequest(pair.request, options), inScope },
        response: serializeHttpResponse(pair.response, options),
        matchContext,
    };
    return cursor === undefined ? entry : { cursor, ...entry };
};

export const resolveHttpBodyMaterialization = (
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
