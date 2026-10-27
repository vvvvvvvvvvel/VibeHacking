import { logStep, makeToolCaller } from "./_utils";

export const runConsole = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Console");

    await runIfTool("write_backend_log", async () => {
        await callTool("write_backend_log", { level: "info", message: "mcp-smoke" });
    });
};
