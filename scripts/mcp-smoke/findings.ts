import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

const pickFirstRequestId = async (
    callTool: (n: string, a: Record<string, unknown>) => Promise<unknown>,
) => {
    const res = await callTool("list_requests", {
        limit: 1,
        fields: ["id"],
    });
    const text = getToolText(res);
    const parsed = tryParseJSON<{ items?: Array<any> }>(text);
    const first = parsed?.items?.[0]?.id ?? null;
    return first ? String(first) : null;
};

export const runFindings = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Findings");

    let requestId: string | null = null;
    let requestIdNum: number | null = null;

    await runIfTool("list_requests", async () => {
        requestId = await pickFirstRequestId(callTool);
        requestIdNum = requestId ? Number(requestId) : null;
        assert(requestId !== null, "no saved requests found for findings");
    });

    assert(requestId !== null, "no request id for findings");
    assert(requestIdNum !== null, "no numeric request id for findings");

    await runIfTool("create_finding", async () => {
        await callTool("create_finding", {
            items: [
                {
                    title: "mcp-smoke",
                    reporter: "mcp-smoke",
                    request_id: requestIdNum,
                    description: "smoke",
                },
            ],
        });
    });

    let createdId: number | null = null;

    await runIfTool("list_findings", async () => {
        const listRes = await callTool("list_findings", {
            limit: 10,
            filter: { reporter: "mcp-smoke" },
            fields: ["id", "title", "reporter", "request_id"],
        });
        const text = getToolText(listRes);
        const parsed = tryParseJSON<{ items?: Array<any> }>(text);
        const finding = parsed?.items?.find((item) => item.title === "mcp-smoke");
        assert(finding?.id, "created finding missing from list_findings");
        createdId = Number(finding.id);

        const withHttpRes = await callTool("list_findings", {
            limit: 1,
            filter: { reporter: "mcp-smoke" },
            include_http: true,
            serialization: {
                regex_excerpt: { regex: "FW-FB-TOKEN|Bearer|token", context_chars: 8 },
            },
            fields: [
                "id",
                "http.id",
                "http.request.url",
                "http.request.body",
                "http.response.raw",
                "http.match_context.excerpts",
            ],
        });
        const withHttpText = getToolText(withHttpRes);
        const withHttp = tryParseJSON<{ items?: Array<any> }>(withHttpText);
        assert(withHttp?.items?.[0]?.http?.id, "list_findings include_http missing http item");
        assert(
            withHttp?.items?.[0]?.http?.request?.body === undefined,
            "list_findings should ignore conflicting HTTP request body field",
        );
        assert(
            withHttp?.items?.[0]?.http?.response?.raw === undefined,
            "list_findings should ignore conflicting HTTP response raw field",
        );
    });

    await runIfTool("get_finding", async () => {
        const byRequest = await callTool("get_finding", {
            request_ids: [requestIdNum],
            reporter: "mcp-smoke",
        });
        if (createdId === null) {
            const text = getToolText(byRequest);
            const parsed = tryParseJSON<Array<any>>(text);
            createdId = parsed?.[0]?.id ? Number(parsed[0].id) : null;
        }
        assert(createdId !== null, "finding id missing for get_finding ids lookup");
        await callTool("get_finding", { ids: [createdId] });
    });

    await runIfTool("finding_exists", async () => {
        await callTool("finding_exists", { request_ids: [requestIdNum], reporter: "mcp-smoke" });
    });

    await runIfTool("update_finding", async () => {
        const listRes = await callTool("get_finding", {
            request_ids: [requestIdNum],
            reporter: "mcp-smoke",
        });
        const text = getToolText(listRes);
        const parsed = tryParseJSON<Array<any>>(text);
        const found = parsed?.[0]?.id;
        assert(found, "finding id missing");
        createdId = Number(found);
        await callTool("update_finding", {
            items: [{ id: Number(found), input: { title: "mcp-smoke-updated" } }],
        });
    });

    await runIfTool("delete_finding", async () => {
        if (!createdId) {
            const listRes = await callTool("get_finding", {
                request_ids: [requestIdNum],
                reporter: "mcp-smoke",
            });
            const text = getToolText(listRes);
            const parsed = tryParseJSON<Array<any>>(text);
            createdId = parsed?.[0]?.id ? Number(parsed[0].id) : null;
        }
        assert(createdId !== null, "finding id missing for delete");
        await callTool("delete_finding", { ids: [createdId] });

        const verifyRes = await callTool("get_finding", {
            request_ids: [requestId],
            reporter: "mcp-smoke",
        });
        const verifyText = getToolText(verifyRes);
        const verifyParsed = tryParseJSON<Array<any>>(verifyText);
        const stillThere = verifyParsed?.some((finding) => Number(finding.id) === createdId);
        assert(!stillThere, "finding not deleted");
    });
};
