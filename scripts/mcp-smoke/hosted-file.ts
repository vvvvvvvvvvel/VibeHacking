import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runHostedFile = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Hosted Files");

    await runIfTool("create_hosted_file", async () => {
        const name = `smoke-${Date.now()}.txt`;
        const createRes = await callTool("create_hosted_file", { name, content: "smoke" });
        const createText = getToolText(createRes);
        const createJson = tryParseJSON<{ id?: string }>(createText);
        const createdId = createJson?.id;
        assert(createdId, "hosted file id missing after create");
        const listRes = await callTool("get_hosted_file", {});
        const listText = getToolText(listRes);
        const listJson = tryParseJSON<unknown>(listText);
        const files = Array.isArray(listJson)
            ? listJson
            : ((listJson as { files?: Array<unknown> } | null)?.files ?? []);
        const created = files.find((f) => f?.id === createdId);
        assert(created, "hosted file not found after create");

        await runIfTool("delete_hosted_file", async () => {
            await callTool("delete_hosted_file", { id: createdId });
            const afterDeleteRes = await callTool("get_hosted_file", {});
            const afterDeleteText = getToolText(afterDeleteRes);
            const afterDeleteJson = tryParseJSON<unknown>(afterDeleteText);
            const afterFiles = Array.isArray(afterDeleteJson)
                ? afterDeleteJson
                : ((afterDeleteJson as { files?: Array<unknown> } | null)?.files ?? []);
            const stillThere = afterFiles.some((f) => f?.id === createdId);
            assert(!stillThere, "hosted file not deleted");
        });
    });
};
