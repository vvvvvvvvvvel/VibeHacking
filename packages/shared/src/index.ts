export type McpSettings = {
    enabled: boolean;
    host: string;
    port: number;
    url: string;
};

export type McpConfigInput = {
    host: string;
    port: number;
};

export type BackendAPI = {
    initialize: () => Promise<void>;
    getSettings: () => Promise<McpSettings>;
    setEnabled: (enabled: boolean) => Promise<McpSettings>;
    setConfig: (config: McpConfigInput) => Promise<McpSettings>;
    testLog: () => Promise<void>;
    getToolPermissions: () => Promise<ToolPermissions>;
    setToolGroupMode: (groupId: string, mode: ToolGroupMode) => Promise<ToolPermissions>;
    confirmAction: (id: number, confirmed: boolean) => Promise<boolean>;
};

export type BackendEvents = {
    "vibe-hacking:confirm-action": (action: string, details: string, id: number) => void;
};

export type ToolGroupMode = "auto" | "confirm" | "disabled";

export type ToolGroupTool = {
    name: string;
    action: string;
};

export type ToolGroup = {
    id: string;
    label: string;
    tools: ToolGroupTool[];
};

export type ToolPermissions = {
    groups: ToolGroup[];
    states: Record<string, ToolGroupMode>;
};

export const MCP_DEFAULT_HOST = "127.0.0.1";
export const MCP_DEFAULT_PORT = 3333;
export const MCP_ENDPOINT_PATH = "/mcp";
export const MCP_PLUGIN_VERSION = "0.1.6";
