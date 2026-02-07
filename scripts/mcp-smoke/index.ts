/* eslint-disable no-console */
import { initSession, logStep, rpc } from "./_utils";
import { runConsole } from "./console";
import { runRuntime } from "./runtime";
import { runProjects } from "./projects";
import { runEnv } from "./env";
import { runHostedFile } from "./hosted-file";
import { runRequests } from "./requests";
import { runFindings } from "./findings";
import { runFilters } from "./filters";
import { runScope } from "./scope";
import { runTamper } from "./tamper";
import { runReplay } from "./replay";
import { runWebsocket } from "./websocket";

const TOOL_RUNNERS: Record<string, (tools: Set<string>) => Promise<void>> = {
    console: runConsole,
    runtime: runRuntime,
    projects: runProjects,
    env: runEnv,
    hostedFile: runHostedFile,
    requests: runRequests,
    findings: runFindings,
    filters: runFilters,
    scope: runScope,
    tamper: runTamper,
    replay: runReplay,
    websocket: runWebsocket,
};

const usage = () => {
    const names = Object.keys(TOOL_RUNNERS).sort().join(", ");
    console.log(`Usage: tsx scripts/mcp-smoke/index.ts <tool|full>`);
    console.log(`Tools: ${names}`);
};

const main = async () => {
    const arg = (process.argv[2] ?? "").trim();
    if (!arg) {
        usage();
        process.exit(1);
    }

    await initSession();

    logStep("List tools");
    const toolsList = await rpc("tools/list", {});
    if (toolsList?.error) {
        throw new Error("tools/list failed");
    }
    const tools = (toolsList?.result as { tools?: Array<{ name: string }> })?.tools ?? [];
    const toolNames = new Set(tools.map((t) => t.name));
    console.log(`tools=${tools.length}`);

    if (arg === "full") {
        for (const key of Object.keys(TOOL_RUNNERS)) {
            await TOOL_RUNNERS[key](toolNames);
        }
        logStep("Done");
        return;
    }

    const runner = TOOL_RUNNERS[arg];
    if (!runner) {
        usage();
        process.exit(1);
    }
    await runner(toolNames);
    logStep("Done");
};

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
