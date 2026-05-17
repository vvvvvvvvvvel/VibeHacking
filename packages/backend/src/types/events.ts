import type { DefineEvents } from "caido:plugin";
import type { McpSettings, ToolPermissions } from "shared";

export type BackendEvents = DefineEvents<{
    "vibe-hacking:tool-action-confirmation-requested": (
        action: string,
        details: string,
        id: number,
    ) => void;
    "vibe-hacking:mcp-server-settings-changed": (settings: McpSettings) => void;
    "vibe-hacking:tool-group-permission-modes-changed": (permissions: ToolPermissions) => void;
}>;
