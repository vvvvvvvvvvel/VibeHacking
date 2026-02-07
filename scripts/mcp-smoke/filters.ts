import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runFilters = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Filters");

    await runIfTool("create-filter-preset", async () => {
        const name = `smoke-${Date.now()}`;
        const alias = `smoke_${Date.now()}`;
        await callTool("create-filter-preset", {
            items: [{ name, alias, clause: 'req.method.eq:"GET"' }],
        });
        const listRes = await callTool("list-filter-presets", {});
        const listText = getToolText(listRes);
        const listJson = tryParseJSON<{
            data?: { filterPresets?: { nodes?: Array<any> } };
            filterPresets?: Array<any>;
        }>(listText);
        const nodes = listJson?.data?.filterPresets?.nodes ?? listJson?.filterPresets ?? [];
        const created = nodes.find((n) => n?.name === name && n?.alias === alias);
        assert(created?.id, "filter preset not found after create");

        await runIfTool("get-filter-preset", async () => {
            await callTool("get-filter-preset", { ids: [Number(created.id)] });
        });

        await runIfTool("update-filter-preset", async () => {
            await callTool("update-filter-preset", {
                id: Number(created.id),
                input: {
                    name: `${name}-updated`,
                    alias,
                    clause: 'req.method.eq:"POST"',
                },
            });
        });

        await runIfTool("delete-filter-preset", async () => {
            await callTool("delete-filter-preset", { ids: [Number(created.id)] });
        });
    });
};
