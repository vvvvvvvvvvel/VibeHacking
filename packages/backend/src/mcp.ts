import { MCP_ENDPOINT_PATH, type McpSettings } from "shared";

import { ConfirmActionStore } from "./confirm-actions";
import { McpRuntime } from "./mcp-runtime";
import { McpSettingsStore } from "./mcp-settings";
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
    private readonly sdk: MCPSDK;
    private readonly confirmStore: ConfirmActionStore;
    private readonly permissionsStore: ToolPermissionsStore;

    constructor(sdk: MCPSDK, opts: McpServerOptions = {}) {
        this.settingsStore = new McpSettingsStore(sdk);
        this.confirmStore = new ConfirmActionStore();
        this.permissionsStore = new ToolPermissionsStore(sdk);
        this.runtime = new McpRuntime(sdk, this.confirmStore, this.permissionsStore);
        this.sdk = sdk;
        this.runtime.setUnexpectedStopHandler(() => {
            this.settingsStore.setEnabled(false);
            void this.settingsStore.save();
        });
        if (opts.host !== undefined || opts.port !== undefined) {
            this.settingsStore.overrideConfig({
                host: opts.host,
                port: opts.port,
            });
        }
    }

    async initialize(): Promise<void> {
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
                this.settingsStore.setEnabled(false);
                await this.settingsStore.save();
                this.sdk.console.error(`MCP start failed: ${error}`);
                throw error;
            });
        }
        await this.initPromise;
    }

    getSettings(): McpSettings {
        return this.settingsStore.getSettings(MCP_ENDPOINT_PATH);
    }

    getToolPermissions() {
        return this.permissionsStore.getPermissions();
    }

    async setToolGroupMode(groupId: string, mode: "auto" | "confirm" | "disabled") {
        const next = await this.permissionsStore.setGroupMode(groupId, mode);
        this.runtime.applyToolPermissions();
        return next;
    }

    async setEnabled(enabled: boolean): Promise<McpSettings> {
        if (this.settingsStore.enabled === enabled) {
            return this.getSettings();
        }
        const previous = this.settingsStore.getSnapshot();
        this.settingsStore.setEnabled(enabled);

        if (enabled) {
            try {
                await this.start();
            } catch (err) {
                this.settingsStore.applySnapshot(previous);
                throw err;
            }
        } else {
            try {
                await this.stop();
            } catch (err) {
                this.settingsStore.applySnapshot(previous);
                throw err;
            }
        }

        await this.settingsStore.save();
        return this.getSettings();
    }

    async setConfig(config: { host: string; port: number }): Promise<McpSettings> {
        const previous = this.settingsStore.getSnapshot();
        this.settingsStore.setConfig(config);
        const next = this.settingsStore.getSnapshot();
        const changed = next.host !== previous.host || next.port !== previous.port;

        if (changed && this.settingsStore.enabled) {
            try {
                await this.stop();
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
        return this.getSettings();
    }

    async start() {
        if (!this.settingsStore.enabled) return;
        await this.runtime.start({
            host: this.settingsStore.host,
            port: this.settingsStore.port,
            endpointPath: MCP_ENDPOINT_PATH,
        });
    }

    private async stop() {
        await this.runtime.stop();
    }

    async resolvePendingAction(id: number, confirmed: boolean) {
        return this.confirmStore.resolvePendingAction(id, confirmed);
    }
}
