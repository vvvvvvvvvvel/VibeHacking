import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runScope = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Scope");

    await runIfTool("create-scope", async () => {
        const name = `smoke-${Date.now()}`;
        await callTool("create-scope", {
            items: [{ name, allowlist: ["example.com"], denylist: [] }],
        });
        const listRes = await callTool("list-scopes", {});
        const listText = getToolText(listRes);
        const listJson = tryParseJSON<{
            data?: { scopes?: { nodes?: Array<any> } };
            scopes?: Array<any>;
        }>(listText);
        const nodes = listJson?.data?.scopes?.nodes ?? listJson?.scopes ?? [];
        const created = nodes.find((n) => n?.name === name);
        assert(created?.id, "scope not found after create");

        await runIfTool("get-scope", async () => {
            await callTool("get-scope", { ids: [Number(created.id)] });
        });

        await runIfTool("update-scope", async () => {
            await callTool("update-scope", {
                id: Number(created.id),
                input: {
                    name: `${name}-updated`,
                    allowlist: ["example.com", "example.org"],
                    denylist: [],
                },
            });
        });

        await runIfTool("rename-scope", async () => {
            await callTool("rename-scope", {
                items: [{ id: Number(created.id), name: `${name}-renamed` }],
            });
        });

        await runIfTool("delete-scope", async () => {
            await callTool("delete-scope", { ids: [Number(created.id)] });
        });
    });
};
