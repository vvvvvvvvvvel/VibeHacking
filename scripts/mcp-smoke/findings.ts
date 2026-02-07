import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

const pickFirstRequestId = async (
    callTool: (n: string, a: Record<string, unknown>) => Promise<unknown>,
) => {
    const res = await callTool("query-requests", { limit: 1 });
    const text = getToolText(res);
    const parsed = tryParseJSON<{ items?: Array<any> }>(text);
    const first = parsed?.items?.[0]?.request?.id ?? parsed?.items?.[0]?.requestId ?? null;
    return first ? String(first) : null;
};

export const runFindings = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Findings");

    let requestId: string | null = null;
    let requestIdNum: number | null = null;

    await runIfTool("query-requests", async () => {
        requestId = await pickFirstRequestId(callTool);
        requestIdNum = requestId ? Number(requestId) : null;
        assert(requestId !== null, "no saved requests found for findings");
    });

    assert(requestId !== null, "no request id for findings");
    assert(requestIdNum !== null, "no numeric request id for findings");

    await runIfTool("create-finding", async () => {
        await callTool("create-finding", {
            items: [
                {
                    title: "mcp-smoke",
                    reporter: "mcp-smoke",
                    requestId: requestIdNum,
                    description: "smoke",
                },
            ],
        });
    });

    await runIfTool("get-finding", async () => {
        await callTool("get-finding", { requestIds: [requestIdNum], reporter: "mcp-smoke" });
    });

    await runIfTool("finding-exists", async () => {
        await callTool("finding-exists", { requestIds: [requestIdNum], reporter: "mcp-smoke" });
    });

    let createdId: number | null = null;

    await runIfTool("update-finding", async () => {
        const listRes = await callTool("get-finding", {
            requestIds: [requestIdNum],
            reporter: "mcp-smoke",
        });
        const text = getToolText(listRes);
        const parsed = tryParseJSON<Array<any>>(text);
        const found = parsed?.[0]?.id;
        assert(found, "finding id missing");
        createdId = Number(found);
        await callTool("update-finding", {
            items: [{ id: Number(found), input: { title: "mcp-smoke-updated" } }],
        });
    });

    await runIfTool("delete-finding", async () => {
        if (!createdId) {
            const listRes = await callTool("get-finding", {
                requestIds: [requestIdNum],
                reporter: "mcp-smoke",
            });
            const text = getToolText(listRes);
            const parsed = tryParseJSON<Array<any>>(text);
            createdId = parsed?.[0]?.id ? Number(parsed[0].id) : null;
        }
        assert(createdId, "finding id missing for delete");
        await callTool("delete-finding", { ids: [createdId] });

        const verifyRes = await callTool("get-finding", {
            requestIds: [requestId],
            reporter: "mcp-smoke",
        });
        const verifyText = getToolText(verifyRes);
        const verifyParsed = tryParseJSON<Array<any>>(verifyText);
        const stillThere = verifyParsed?.some((finding) => Number(finding.id) === createdId);
        assert(!stillThere, "finding not deleted");
    });
};
