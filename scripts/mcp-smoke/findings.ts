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

    await runIfTool("get_finding", async () => {
        await callTool("get_finding", { request_ids: [requestIdNum], reporter: "mcp-smoke" });
    });

    await runIfTool("finding_exists", async () => {
        await callTool("finding_exists", { request_ids: [requestIdNum], reporter: "mcp-smoke" });
    });

    let createdId: number | null = null;

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
