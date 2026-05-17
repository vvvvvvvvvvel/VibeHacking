import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

const assertBodyNotProjected = (label: string, payload: any) => {
    assert(payload?.body === undefined, `${label} body should not be projected`);
    assert(payload?.raw === undefined, `${label} raw should not be projected`);
};

const assertBodyIncluded = (label: string, payload: any) => {
    if (!payload) return;
    assert(payload.raw?.encoding === "text", `${label} raw should be present as text`);
};

const assertRawExcerptsDedupedWhenBodyMatches = (label: string, excerpts: Array<any>) => {
    const bodyTextsByRawPath = new Map([
        ["request.raw.text", new Set<string>()],
        ["response.raw.text", new Set<string>()],
    ]);
    for (const excerpt of excerpts) {
        if (excerpt?.path === "request.body.text" && typeof excerpt.text === "string") {
            bodyTextsByRawPath.get("request.raw.text")?.add(excerpt.text);
        }
        if (excerpt?.path === "response.body.text" && typeof excerpt.text === "string") {
            bodyTextsByRawPath.get("response.raw.text")?.add(excerpt.text);
        }
    }
    for (const excerpt of excerpts) {
        if (typeof excerpt?.path !== "string" || typeof excerpt.text !== "string") continue;
        assert(
            !bodyTextsByRawPath.get(excerpt.path)?.has(excerpt.text),
            `${label} should omit duplicate raw excerpt when body excerpt has the same text`,
        );
    }
};

const pickFirstRequestId = async (
    callTool: (n: string, a: Record<string, unknown>) => Promise<unknown>,
) => {
    const res = await callTool("list_requests", {
        limit: 1,
        fields: ["cursor", "id", "request.method", "request.url", "response.status_code"],
    });
    const text = getToolText(res);
    const parsed = tryParseJSON<{ items?: Array<any> }>(text);
    const first = parsed?.items?.[0]?.id ?? null;
    return first ? String(first) : null;
};

export const runRequests = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Requests");

    let requestId: string | null = null;
    let requestIdNum: number | null = null;

    await runIfTool("list_requests", async () => {
        requestId = await pickFirstRequestId(callTool);
        requestIdNum = requestId ? Number(requestId) : null;
        assert(requestId !== null, "no saved requests found");

        const res = await callTool("list_requests", {
            limit: 1,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ items?: Array<any>; page_info?: any }>(text);
        const first = parsed?.items?.[0];
        assert(Array.isArray(parsed?.items), "list_requests items missing");
        assert(parsed?.page_info !== undefined, "list_requests page_info missing");
        if (first) {
            assert(
                first.request?.body === undefined,
                "list_requests default body should be omitted",
            );
        }

        const withBody = await callTool("list_requests", {
            limit: 1,
            serialization: { include_body: true },
        });
        const withBodyText = getToolText(withBody);
        const withBodyParsed = tryParseJSON<{ items?: Array<any> }>(withBodyText);
        const withBodyFirst = withBodyParsed?.items?.[0];
        if (withBodyFirst) {
            assert(withBodyFirst.request?.body !== undefined, "include_body request body missing");
        }

        const projected = await callTool("list_requests", {
            limit: 1,
            fields: ["cursor", "id", "request.method", "request.url", "response.status_code"],
        });
        const projectedText = getToolText(projected);
        const projectedParsed = tryParseJSON<{ items?: Array<any> }>(projectedText);
        const projectedFirst = projectedParsed?.items?.[0];
        if (projectedFirst) {
            assert(projectedFirst.cursor, "projected cursor missing");
            assert(projectedFirst.request?.method, "projected request method missing");
            assert(projectedFirst.request?.headers === undefined, "projection should omit headers");
        }

        const regexWithConflicts = await callTool("list_requests", {
            limit: 1,
            serialization: {
                regex_excerpt: { regex: "GET|POST", context_chars: 0 },
            },
            fields: [
                "id",
                "request.body",
                "request.raw",
                "response.body",
                "response.raw",
                "match_context.excerpts",
            ],
        });
        const regexWithConflictsText = getToolText(regexWithConflicts);
        const regexWithConflictsParsed = tryParseJSON<{ items?: Array<any> }>(
            regexWithConflictsText,
        );
        const regexWithConflictsFirst = regexWithConflictsParsed?.items?.[0];
        if (regexWithConflictsFirst) {
            assert(
                regexWithConflictsFirst.request === undefined,
                "regex_excerpt should ignore conflicting request body/raw fields",
            );
            assert(
                regexWithConflictsFirst.response === undefined,
                "regex_excerpt should ignore conflicting response body/raw fields",
            );
            assert(
                regexWithConflictsFirst.match_context?.excerpts?.length > 0,
                "regex_excerpt excerpts missing when conflicting fields are ignored",
            );
        }

        const regexExcerptTolerantInput = await callTool("list_requests", {
            limit: 1,
            serialization: {
                regex_excerpt: "GET|POST",
            },
            fields: ["id", "match_context.excerpts"],
        });
        const regexExcerptTolerantInputText = getToolText(regexExcerptTolerantInput);
        const regexExcerptTolerantInputParsed = tryParseJSON<{ items?: Array<any> }>(
            regexExcerptTolerantInputText,
        );
        const regexExcerptTolerantInputFirst = regexExcerptTolerantInputParsed?.items?.[0];
        if (regexExcerptTolerantInputFirst) {
            assert(
                regexExcerptTolerantInputFirst.match_context?.excerpts?.length > 0,
                "regex_excerpt tolerant input should produce excerpts",
            );
        }

        const bodyRawDedupe = await callTool("list_requests", {
            limit: 1,
            serialization: {
                regex_excerpt: { regex: "authMethods|debugData|clusterId", context_chars: 16 },
            },
            fields: ["id", "match_context.excerpts"],
        });
        const bodyRawDedupeText = getToolText(bodyRawDedupe);
        const bodyRawDedupeParsed = tryParseJSON<{ items?: Array<any> }>(bodyRawDedupeText);
        const bodyRawDedupeExcerpts =
            bodyRawDedupeParsed?.items?.[0]?.match_context?.excerpts ?? [];
        if (bodyRawDedupeExcerpts.length > 0) {
            assertRawExcerptsDedupedWhenBodyMatches(
                "list_requests regex_excerpt",
                bodyRawDedupeExcerpts,
            );
        }
    });

    assert(requestId !== null, "no request id for subsequent request tests");
    assert(requestIdNum !== null, "no numeric request id for subsequent request tests");

    await runIfTool("get_requests_by_ids", async () => {
        const res = await callTool("get_requests_by_ids", {
            ids: [requestIdNum],
            fields: ["id", "request.raw", "response.raw"],
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ requested?: number; found?: number; results?: Array<any> }>(
            text,
        );
        assert(parsed?.requested === 1, "get_requests_by_ids requested mismatch");
        const first = parsed?.results?.[0]?.item;
        if (first) {
            assertBodyIncluded("get_requests_by_ids request", first.request);
            if (first.response) assertBodyIncluded("get_requests_by_ids response", first.response);
        }

        const resNoBody = await callTool("get_requests_by_ids", {
            ids: [requestIdNum],
            fields: ["id", "request.method", "response.status_code"],
        });
        const textNoBody = getToolText(resNoBody);
        const parsedNoBody = tryParseJSON<{ results?: Array<any> }>(textNoBody);
        const firstNoBody = parsedNoBody?.results?.[0]?.item;
        if (firstNoBody) {
            assertBodyNotProjected("get_requests_by_ids request", firstNoBody.request);
            if (firstNoBody.response)
                assertBodyNotProjected("get_requests_by_ids response", firstNoBody.response);
        }
    });

    await runIfTool("match_requests", async () => {
        await callTool("match_requests", {
            httpql: 'req.method.eq:"GET"',
            ids: [requestIdNum],
        });
    });

    await runIfTool("check_requests_scope", async () => {
        await callTool("check_requests_scope", {
            items: [{ ids: [requestIdNum] }],
        });
    });

    await runIfTool("summarize_request_cookies", async () => {
        await callTool("summarize_request_cookies", {
            limit: 10,
        });
    });

    await runIfTool("summarize_request_auth_headers", async () => {
        await callTool("summarize_request_auth_headers", {
            limit: 10,
        });
    });

    await runIfTool("send_requests", async () => {
        await callTool("send_requests", { ids: [requestIdNum], options: { save: true } });
    });
};
