import { assert, getToolText, logStep, makeToolCaller } from "./_utils";

export const runRuntime = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Runtime");

    await runIfTool("get_caido_version", async () => {
        const res = await callTool("get_caido_version", {});
        const text = getToolText(res);
        assert(text.length > 0, "Caido version empty");
    });
};
