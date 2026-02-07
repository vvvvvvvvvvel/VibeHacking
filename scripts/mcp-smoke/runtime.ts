import { assert, getToolText, logStep, makeToolCaller } from "./_utils";

export const runRuntime = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Runtime");

    await runIfTool("version", async () => {
        const res = await callTool("version", {});
        const text = getToolText(res);
        assert(text.length > 0, "version empty");
    });
};
