import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runScope = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Scope");

    await runIfTool("create_scope", async () => {
        const name = `smoke-${Date.now()}`;
        await callTool("create_scope", {
            items: [{ name, allowlist: ["example.com"], denylist: [] }],
        });
        const listRes = await callTool("list_scopes", {});
        const listText = getToolText(listRes);
        const listJson = tryParseJSON<{
            data?: { scopes?: { nodes?: Array<any> } };
            scopes?: Array<any>;
        }>(listText);
        const nodes = listJson?.data?.scopes?.nodes ?? listJson?.scopes ?? [];
        const created = nodes.find((n) => n?.name === name);
        assert(created?.id, "scope not found after create");

        await runIfTool("get_scope", async () => {
            await callTool("get_scope", { ids: [Number(created.id)] });
        });

        await runIfTool("update_scope", async () => {
            await callTool("update_scope", {
                id: Number(created.id),
                input: {
                    name: `${name}-updated`,
                    allowlist: ["example.com", "example.org"],
                    denylist: [],
                },
            });
        });

        await runIfTool("rename_scope", async () => {
            await callTool("rename_scope", {
                items: [{ id: Number(created.id), name: `${name}-renamed` }],
            });
        });

        await runIfTool("delete_scope", async () => {
            await callTool("delete_scope", { ids: [Number(created.id)] });
        });
    });
};
