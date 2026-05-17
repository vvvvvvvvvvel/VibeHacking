import { MCP_CONTROL_ENDPOINT_PATH, MCP_ENDPOINT_PATH, type McpSettings } from "shared";

import { ConfirmActionStore } from "./confirm-actions";
import { createMcpControlHandler } from "./mcp-control";
import { McpListenerManager } from "./mcp-listeners";
import { McpRuntime } from "./mcp-runtime";
import { McpSettingsStore } from "./mcp-settings";
import type { HttpHandler } from "./server";
import { ToolPermissionsStore } from "./tool-permissions";
import type { MCPSDK } from "./types/sdk";
export type { BackendEvents } from "./types/events";

type McpServerOptions = {
    host?: string;
    port?: number;
};

export class McpHttpServer {
    private initPromise: Promise<void> | undefined;
    private readonly settingsStore: McpSettingsStore;
    private readonly runtime: McpRuntime;
    private readonly listeners: McpListenerManager;
    private readonly sdk: MCPSDK;
    private readonly confirmStore: ConfirmActionStore;
    private readonly permissionsStore: ToolPermissionsStore;
    private readonly controlHandler: HttpHandler;
    private mcpHandler: HttpHandler | undefined;

    constructor(sdk: MCPSDK, opts: McpServerOptions = {}) {
        this.settingsStore = new McpSettingsStore(sdk);
        this.confirmStore = new ConfirmActionStore();
        this.permissionsStore = new ToolPermissionsStore(sdk);
        this.runtime = new McpRuntime(sdk, this.confirmStore, this.permissionsStore);
        this.sdk = sdk;
        this.controlHandler = createMcpControlHandler({
            getMcpServerSettings: () => this.getMcpServerSettings(),
            setMcpServerEnabled: async (enabled) => await this.setMcpServerEnabled(enabled),
            updateMcpServerConfig: async (config) => await this.updateMcpServerConfig(config),
            getToolGroupPermissionModes: () => this.getToolGroupPermissionModes(),
            setToolGroupPermissionMode: async (groupId, mode) =>
                await this.setToolGroupPermissionMode(groupId, mode),
            setAllToolGroupPermissionModes: async (mode) =>
                await this.setAllToolGroupPermissionModes(mode),
        });
        this.listeners = new McpListenerManager({
            sdk,
            controlEndpointPath: MCP_CONTROL_ENDPOINT_PATH,
            mcpEndpointPath: MCP_ENDPOINT_PATH,
            controlHandler: this.controlHandler,
            mcpHandler: async (request, context) => {
                this.mcpHandler ??= this.runtime.createHandler();
                return await this.mcpHandler(request, context);
            },
            isMcpEnabled: () => this.settingsStore.enabled,
            onBeforeMcpListenerStop: async () => await this.runtime.stop(),
            onUnexpectedMcpStop: () => {
                this.settingsStore.setMcpServerEnabled(false);
                void this.settingsStore.save();
                this.emitSettingsChanged();
            },
        });
        if (opts.host !== undefined || opts.port !== undefined) {
            this.settingsStore.overrideConfig({
                host: opts.host,
                port: opts.port,
            });
        }
    }

    async initializeMcpServer(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = (async () => {
                const snapshot = await this.settingsStore.load();
                if (snapshot !== undefined) {
                    this.settingsStore.applySnapshot(snapshot);
                }
                await this.permissionsStore.load();
                this.runtime.initializeTools();
                await this.start();
            })().catch(async (error) => {
                this.settingsStore.setMcpServerEnabled(false);
                await this.settingsStore.save();
                this.sdk.console.error(`MCP start failed: ${error}`);
                throw error;
            });
        }
        await this.initPromise;
    }

    getMcpServerSettings(): McpSettings {
        return this.settingsStore.getMcpServerSettings(
            MCP_ENDPOINT_PATH,
            MCP_CONTROL_ENDPOINT_PATH,
        );
    }

    getToolGroupPermissionModes() {
        return this.permissionsStore.getPermissions();
    }

    async setToolGroupPermissionMode(groupId: string, mode: "auto" | "confirm" | "disabled") {
        const next = await this.permissionsStore.setGroupMode(groupId, mode);
        this.runtime.applyToolPermissions();
        this.emitToolPermissionsChanged(next);
        return next;
    }

    async setAllToolGroupPermissionModes(mode: "auto" | "confirm" | "disabled") {
        const next = await this.permissionsStore.setAllGroupModes(mode);
        this.runtime.applyToolPermissions();
        this.emitToolPermissionsChanged(next);
        return next;
    }

    async setMcpServerEnabled(enabled: boolean): Promise<McpSettings> {
        if (this.settingsStore.enabled === enabled) {
            await this.start();
            return this.getMcpServerSettings();
        }
        const previous = this.settingsStore.getSnapshot();
        this.settingsStore.setMcpServerEnabled(enabled);

        try {
            await this.start();
        } catch (err) {
            this.settingsStore.applySnapshot(previous);
            throw err;
        }

        await this.settingsStore.save();
        const settings = this.getMcpServerSettings();
        this.emitSettingsChanged(settings);
        return settings;
    }

    async updateMcpServerConfig(config: { host: string; port: number }): Promise<McpSettings> {
        const previous = this.settingsStore.getSnapshot();
        this.settingsStore.updateMcpServerConfig(config);
        const next = this.settingsStore.getSnapshot();
        const changed = next.host !== previous.host || next.port !== previous.port;

        if (changed) {
            try {
                await this.start();
            } catch (err) {
                this.settingsStore.applySnapshot(previous);
                try {
                    await this.start();
                } catch {
                    // Ignore restart errors and rethrow original.
                }
                const message = err instanceof Error ? err.message : String(err);
                if (message.includes("Address already in use")) {
                    throw new Error(`Port ${next.port} is already in use.`);
                }
                throw err;
            }
        }

        await this.settingsStore.save();
        const settings = this.getMcpServerSettings();
        this.emitSettingsChanged(settings);
        return settings;
    }

    async start() {
        await this.listeners.apply({
            mcpHost: this.settingsStore.host,
            port: this.settingsStore.port,
            mcpEnabled: this.settingsStore.enabled,
        });
    }

    async resolveToolActionConfirmation(id: number, confirmed: boolean) {
        return this.confirmStore.resolveToolActionConfirmation(id, confirmed);
    }

    private emitSettingsChanged(settings = this.getMcpServerSettings()) {
        this.sdk.api.send("vibe-hacking:mcp-server-settings-changed", settings);
    }

    private emitToolPermissionsChanged(permissions = this.getToolGroupPermissionModes()) {
        this.sdk.api.send("vibe-hacking:tool-group-permission-modes-changed", permissions);
    }
}
