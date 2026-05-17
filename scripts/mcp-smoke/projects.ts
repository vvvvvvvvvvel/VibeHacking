import { logStep, makeToolCaller } from "./_utils";

export const runProjects = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Projects");

    await runIfTool("get_project_info", async () => {
        await callTool("get_project_info", { field: "full" });
    });
};
