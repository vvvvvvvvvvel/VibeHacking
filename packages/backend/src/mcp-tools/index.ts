import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ConfirmActionStore } from "../confirm-actions";
import { createGraphqlExecutor } from "../graphql";
import type { ToolPermissionsStore } from "../tool-permissions";
import type { MCPSDK } from "../types/sdk";

import { registerAutomateTools } from "./automate";
import { registerConsoleTools } from "./console";
import { registerEnvTools } from "./env";
import { registerFilterTools } from "./filters";
import { registerFindingsTools } from "./findings";
import { registerHostedFileTools } from "./hosted-file";
import { registerProjectTools } from "./projects";
import { attachToolActionRegistry, type ToolContext } from "./register";
import { registerReplayTools } from "./replay";
import { registerRequestTools } from "./requests";
import { registerRuntimeTools } from "./runtime";
import { registerScopeTools } from "./scope";
import { registerSitemapTools } from "./sitemap";
import { registerTamperTools } from "./tamper";
import { registerTrafficControlTools } from "./traffic-control";
import { registerWebsocketTools } from "./websocket";

export function registerMcpTools(
    server: McpServer,
    sdk: MCPSDK,
    store: ConfirmActionStore,
    permissions: ToolPermissionsStore,
) {
    const toolsByAction = new Map<string, RegisteredTool>();
    attachToolActionRegistry(server, toolsByAction);
    const ctx: ToolContext = {
        server,
        sdk,
        graphql: createGraphqlExecutor(sdk),
        store,
        permissions,
    };

    registerEnvTools(ctx);
    registerProjectTools(ctx);
    registerScopeTools(ctx);
    registerHostedFileTools(ctx);
    registerTrafficControlTools(ctx);
    registerAutomateTools(ctx);
    registerFindingsTools(ctx);
    registerRequestTools(ctx);
    registerSitemapTools(ctx);
    registerConsoleTools(ctx);
    registerRuntimeTools(ctx);
    registerReplayTools(ctx);
    registerFilterTools(ctx);
    registerTamperTools(ctx);
    registerWebsocketTools(ctx);

    return { toolsByAction };
}
