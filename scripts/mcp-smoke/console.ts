import { logStep, makeToolCaller } from "./_utils";

export const runConsole = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Console");

    await runIfTool("log", async () => {
        await callTool("log", { level: "info", message: "mcp-smoke" });
    });
};
