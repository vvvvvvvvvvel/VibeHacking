import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

const assertBodyOmitted = (label: string, payload: any) => {
    if (!payload) return;
    assert(payload.body === null, `${label} body should be null`);
    assert(payload.raw === null, `${label} raw should be null`);
    assert(payload.bodyEncoding === "omitted", `${label} bodyEncoding should be omitted`);
};

const assertBodyIncluded = (label: string, payload: any) => {
    if (!payload) return;
    assert(payload.raw !== null, `${label} raw should be present`);
};

const pickFirstRequestId = async (
    callTool: (n: string, a: Record<string, unknown>) => Promise<unknown>,
) => {
    const res = await callTool("query-requests", { limit: 1 });
    const text = getToolText(res);
    const parsed = tryParseJSON<{ items?: Array<any> }>(text);
    const first = parsed?.items?.[0]?.request?.id ?? parsed?.items?.[0]?.requestId ?? null;
    return first ? String(first) : null;
};

export const runRequests = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Requests");

    let requestId: string | null = null;
    let requestIdNum: number | null = null;

    await runIfTool("query-requests", async () => {
        requestId = await pickFirstRequestId(callTool);
        requestIdNum = requestId ? Number(requestId) : null;
        assert(requestId !== null, "no saved requests found");
        const res = await callTool("query-requests", { limit: 1 });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ items?: Array<any> }>(text);
        const first = parsed?.items?.[0];
        if (first) {
            assertBodyOmitted("query-requests request (default)", first.request);
            assertBodyOmitted("query-requests response (default)", first.response);
        }
        const resWithBody = await callTool("query-requests", {
            limit: 1,
            serialization: { includeBody: true },
        });
        const textWithBody = getToolText(resWithBody);
        const parsedWithBody = tryParseJSON<{ items?: Array<any> }>(textWithBody);
        const firstWithBody = parsedWithBody?.items?.[0];
        if (firstWithBody) {
            assertBodyIncluded("query-requests request (includeBody)", firstWithBody.request);
            if (firstWithBody.response) {
                assertBodyIncluded("query-requests response (includeBody)", firstWithBody.response);
            }
        }
    });

    assert(requestId !== null, "no request id for subsequent request tests");
    assert(requestIdNum !== null, "no numeric request id for subsequent request tests");

    await runIfTool("get-request", async () => {
        const res = await callTool("get-request", { requestIds: [requestIdNum] });
        const text = getToolText(res);
        const parsed = tryParseJSON<Array<any>>(text);
        const first = parsed?.[0];
        if (first) {
            assertBodyIncluded("get-request request (default)", first.request);
            if (first.response) {
                assertBodyIncluded("get-request response (default)", first.response);
            }
        }
        const resNoBody = await callTool("get-request", {
            requestIds: [requestIdNum],
            serialization: { includeBody: false },
        });
        const textNoBody = getToolText(resNoBody);
        const parsedNoBody = tryParseJSON<Array<any>>(textNoBody);
        const firstNoBody = parsedNoBody?.[0];
        if (firstNoBody) {
            assertBodyOmitted("get-request request (includeBody=false)", firstNoBody.request);
            if (firstNoBody.response) {
                assertBodyOmitted("get-request response (includeBody=false)", firstNoBody.response);
            }
        }
    });

    await runIfTool("get-request-raw", async () => {
        await callTool("get-request-raw", { requestIds: [requestIdNum] });
    });

    await runIfTool("match-request", async () => {
        await callTool("match-request", {
            filter: 'req.method.eq:"GET"',
            requestIds: [requestIdNum],
        });
    });

    await runIfTool("is-request-in-scope", async () => {
        await callTool("is-request-in-scope", {
            items: [{ requestIds: [requestIdNum], scopeIds: null }],
        });
    });

    await runIfTool("send-request", async () => {
        await callTool("send-request", { requestIds: [requestIdNum], options: { save: true } });
    });
};
