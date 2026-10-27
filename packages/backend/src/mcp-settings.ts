import { readFile, writeFile } from "fs/promises";
import { join } from "path";

import { MCP_DEFAULT_HOST, MCP_DEFAULT_PORT, type McpSettings } from "shared";
import { z } from "zod";

import { getKvSdk, type KVSDK, type MCPSDK } from "./types/sdk";

export type SettingsSnapshot = {
    enabled: boolean;
    host: string;
    port: number;
};

const settingsSchema = z.object({
    enabled: z.boolean().optional(),
    host: z.string().trim().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
});

const SETTINGS_KEY = "mcp-server-settings";

export class McpSettingsStore {
    private readonly sdk: MCPSDK;
    private readonly kv: KVSDK;
    private readonly settingsPath: string;
    private keyDefined = false;
    private persistQueue: Promise<void> = Promise.resolve();
    private state: SettingsSnapshot;

    constructor(sdk: MCPSDK) {
        this.sdk = sdk;
        this.kv = getKvSdk(sdk);
        this.settingsPath = join(this.sdk.meta.path(), "settings.json");
        this.state = {
            enabled: false,
            host: MCP_DEFAULT_HOST,
            port: MCP_DEFAULT_PORT,
        };
    }

    getSnapshot(): SettingsSnapshot {
        return { ...this.state };
    }

    applySnapshot(snapshot: SettingsSnapshot) {
        this.state = { ...snapshot };
    }

    get enabled(): boolean {
        return this.state.enabled;
    }

    get host(): string {
        return this.state.host;
    }

    get port(): number {
        return this.state.port;
    }

    getMcpServerSettings(endpointPath: string, controlEndpointPath: string): McpSettings {
        const displayHost = this.state.host === "0.0.0.0" ? "127.0.0.1" : this.state.host;
        return {
            enabled: this.state.enabled,
            host: this.state.host,
            port: this.state.port,
            url: `http://${displayHost}:${this.state.port}${endpointPath}`,
            controlUrl: `http://127.0.0.1:${this.state.port}${controlEndpointPath}`,
        };
    }

    setMcpServerEnabled(enabled: boolean) {
        this.state = { ...this.state, enabled };
    }

    overrideConfig(input: { host?: string; port?: number }) {
        const host = input.host ?? this.state.host;
        const port = input.port ?? this.state.port;
        const validated = this.validateConfig({ host, port });
        this.state = { ...this.state, ...validated };
    }

    updateMcpServerConfig(input: { host: string; port: number }) {
        const { host, port } = this.validateConfig(input);
        this.state = { ...this.state, host, port };
    }

    async load(): Promise<SettingsSnapshot | undefined> {
        await this.defineKey();
        try {
            const stored = await this.kv.get(SETTINGS_KEY);
            if (stored !== null && stored !== undefined) {
                const snapshot = this.parseSnapshot(stored);
                await this.clearLegacyFile();
                return snapshot;
            }
        } catch (err) {
            this.sdk.console.error(`Failed to read MCP settings from KV: ${this.message(err)}`);
            throw err;
        }

        try {
            const raw = await readFile(this.settingsPath, { encoding: "utf8" });
            const snapshot = this.parseSnapshot(JSON.parse(String(raw)) as unknown);
            this.state = snapshot;
            await this.save();
            await this.clearLegacyFile();
            return snapshot;
        } catch (err) {
            const message = this.message(err);
            if (!this.isMissingFileError(message)) {
                this.sdk.console.error(`Failed to migrate legacy MCP settings: ${message}`);
            }
            await this.save();
            await this.clearLegacyFile();
            return undefined;
        }
    }

    save(): Promise<void> {
        const operation = this.persistQueue.then(() => this.saveInternal());
        this.persistQueue = operation.catch(() => undefined);
        return operation;
    }

    private async saveInternal(): Promise<void> {
        await this.defineKey();
        await this.kv.set(SETTINGS_KEY, { ...this.state });
    }

    private async defineKey() {
        if (this.keyDefined) return;
        await this.kv.define(SETTINGS_KEY, { exportable: true });
        this.keyDefined = true;
    }

    private parseSnapshot(value: unknown): SettingsSnapshot {
        const parsed = settingsSchema.parse(value);
        return {
            enabled: parsed.enabled ?? this.state.enabled,
            host: parsed.host ?? this.state.host,
            port: parsed.port ?? this.state.port,
        };
    }

    private async clearLegacyFile() {
        try {
            await readFile(this.settingsPath);
            await writeFile(this.settingsPath, "{}\n");
        } catch (err) {
            const message = this.message(err);
            if (!this.isMissingFileError(message)) {
                this.sdk.console.error(`Failed to clear legacy MCP settings: ${message}`);
            }
        }
    }

    private message(error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }

    private isMissingFileError(message: string) {
        const normalized = message.toLowerCase();
        return normalized.includes("no such file") || normalized.includes("enoent");
    }

    private validateConfig(input: { host: string; port: number }) {
        const nextHost = input.host.trim();
        const nextPort = Math.floor(input.port);
        if (!nextHost) {
            throw new Error("Host is required");
        }
        if (!Number.isFinite(nextPort) || nextPort <= 0 || nextPort > 65535) {
            throw new Error("Port must be between 1 and 65535");
        }
        return { host: nextHost, port: nextPort };
    }
}
