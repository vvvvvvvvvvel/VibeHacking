import { McpHttpServer } from "./mcp";
import type { MCPSDK } from "./types/sdk";
export type { API } from "./types/api";
export type { BackendEvents } from "./types/events";

export function init(sdk: MCPSDK) {
    const mcp = new McpHttpServer(sdk);
    sdk.api.register("initialize", async () => {
        return await mcp.initialize();
    });
    sdk.api.register("getSettings", () => {
        return mcp.getSettings();
    });
    sdk.api.register("setEnabled", async (_sdk: MCPSDK, enabled: boolean) => {
        return await mcp.setEnabled(enabled);
    });
    sdk.api.register("setConfig", async (_sdk: MCPSDK, config: { host: string; port: number }) => {
        return await mcp.setConfig(config);
    });
    sdk.api.register("testLog", () => {});
    sdk.api.register("getToolPermissions", () => {
        return mcp.getToolPermissions();
    });
    sdk.api.register(
        "setToolGroupMode",
        async (_sdk: MCPSDK, groupId: string, mode: "auto" | "confirm" | "disabled") => {
            return await mcp.setToolGroupMode(groupId, mode);
        },
    );
    sdk.api.register("confirmAction", async (_sdk: MCPSDK, id: number, confirmed: boolean) => {
        const resolved = await mcp.resolvePendingAction(Number(id), confirmed);
        return resolved !== null;
    });
}

void init;
