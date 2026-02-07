import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodType } from "zod";

import type { ConfirmActionStore } from "../confirm-actions";
import type { ToolGroupId, ToolPermissionsStore } from "../tool-permissions";
import type { MCPSDK } from "../types/sdk";

import type { ActionPayload, ToolResult } from "./shared";
import { formatDetails, isToolResult } from "./shared";

export type ToolContext = {
    server: McpServer;
    sdk: MCPSDK;
    store: ConfirmActionStore;
    permissions: ToolPermissionsStore;
    toolsByAction: Map<string, RegisteredTool>;
};

const executeAction = async (
    sdk: MCPSDK,
    store: ConfirmActionStore,
    permissions: ToolPermissionsStore,
    payload: ActionPayload,
): Promise<ToolResult> => {
    const mode = permissions.getModeForAction(payload.action);
    if (mode === "disabled") {
        throw new Error("Tool disabled");
    }
    const needsConfirm = mode === "confirm";
    if (needsConfirm) {
        const { id, promise } = store.createPendingAction(
            payload.action,
            payload.params,
            async () => {
                const result = await store.runAction(payload.action, payload.params);
                if (isToolResult(result)) return result;
                return { content: [{ type: "text", text: "ok" }] } as ToolResult;
            },
        );
        sdk.api.send("caido-mcp:confirm-action", payload.action, formatDetails(payload), id);
        const result = await promise;
        if (!result.confirmed) {
            return {
                content: [{ type: "text", text: `User rejected action ${payload.action}` }],
            };
        }
        if (result.error !== undefined) {
            sdk.console.error(`MCP action failed: ${result.action} id=${id} error=${result.error}`);
            return {
                content: [{ type: "text", text: `error: ${result.error}` }],
            };
        }
        return (
            (result.result as ToolResult) ?? {
                content: [{ type: "text", text: "ok" }],
            }
        );
    }
    const result = await store.runAction(payload.action, payload.params);
    if (isToolResult(result)) return result;
    return { content: [{ type: "text", text: "ok" }] };
};

export const registerToolAction = (
    server: McpServer,
    sdk: MCPSDK,
    store: ConfirmActionStore,
    permissions: ToolPermissionsStore,
    config: {
        action: string;
        group: ToolGroupId;
        toolName: string;
        description: string;
        inputSchema: ZodType;
        handler: (params: Record<string, unknown>) => unknown;
        annotations?: Partial<ToolAnnotations>;
        confirm?: never;
    },
): RegisteredTool => {
    const annotations: ToolAnnotations = {
        ...config.annotations,
    };
    store.registerAction(config.action, config.handler);
    permissions.registerTool(config.action, config.group, config.toolName);
    return server.registerTool(
        config.toolName,
        {
            description: config.description,
            inputSchema: config.inputSchema,
            annotations,
        },
        async (input: unknown) => {
            const payload: ActionPayload = {
                action: config.action,
                params: input as Record<string, unknown>,
            };
            return await executeAction(sdk, store, permissions, payload);
        },
    );
};
