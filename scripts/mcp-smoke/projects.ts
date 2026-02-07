import { logStep, makeToolCaller } from "./_utils";

export const runProjects = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Projects");

    await runIfTool("get-project-info", async () => {
        await callTool("get-project-info", { field: "full" });
    });
};
