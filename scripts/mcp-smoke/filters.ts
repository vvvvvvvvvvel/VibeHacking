import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runFilters = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Filters");

    await runIfTool("create_filter_preset", async () => {
        const name = `smoke-${Date.now()}`;
        const alias = `smoke_${Date.now()}`;
        await callTool("create_filter_preset", {
            items: [{ name, alias, clause: 'req.method.eq:"GET"' }],
        });
        const listRes = await callTool("list_filter_presets", {});
        const listText = getToolText(listRes);
        const listJson = tryParseJSON<{
            data?: { filter_presets?: { nodes?: Array<any> } };
            filter_presets?: Array<any>;
        }>(listText);
        const nodes = listJson?.data?.filter_presets?.nodes ?? listJson?.filter_presets ?? [];
        const created = nodes.find((n) => n?.name === name && n?.alias === alias);
        assert(created?.id, "filter preset not found after create");

        await runIfTool("get_filter_preset", async () => {
            await callTool("get_filter_preset", { ids: [Number(created.id)] });
        });

        await runIfTool("update_filter_preset", async () => {
            await callTool("update_filter_preset", {
                id: Number(created.id),
                input: {
                    name: `${name}-updated`,
                    alias,
                    clause: 'req.method.eq:"POST"',
                },
            });
        });

        await runIfTool("delete_filter_preset", async () => {
            await callTool("delete_filter_preset", { ids: [Number(created.id)] });
        });
    });
};
