import { McpHttpServer } from "./mcp";
import type { MCPSDK } from "./types/sdk";
export type { API } from "./types/api";
export type { BackendEvents } from "./types/events";

export function init(sdk: MCPSDK) {
    const mcp = new McpHttpServer(sdk);
    sdk.api.register("initializeMcpServer", async () => {
        return await mcp.initializeMcpServer();
    });
    sdk.api.register("getMcpServerSettings", () => {
        return Promise.resolve(mcp.getMcpServerSettings());
    });
    sdk.api.register("setMcpServerEnabled", async (_sdk: MCPSDK, enabled: boolean) => {
        return await mcp.setMcpServerEnabled(enabled);
    });
    sdk.api.register(
        "updateMcpServerConfig",
        async (_sdk: MCPSDK, config: { host: string; port: number }) => {
            return await mcp.updateMcpServerConfig(config);
        },
    );
    sdk.api.register("getToolGroupPermissionModes", () => {
        return Promise.resolve(mcp.getToolGroupPermissionModes());
    });
    sdk.api.register(
        "setToolGroupPermissionMode",
        async (_sdk: MCPSDK, groupId: string, mode: "auto" | "confirm" | "disabled") => {
            return await mcp.setToolGroupPermissionMode(groupId, mode);
        },
    );
    sdk.api.register(
        "setAllToolGroupPermissionModes",
        async (_sdk: MCPSDK, mode: "auto" | "confirm" | "disabled") => {
            return await mcp.setAllToolGroupPermissionModes(mode);
        },
    );
    sdk.api.register(
        "resolveToolActionConfirmation",
        async (_sdk: MCPSDK, id: number, confirmed: boolean) => {
            const resolved = await mcp.resolveToolActionConfirmation(Number(id), confirmed);
            return resolved !== null;
        },
    );
}

void init;
