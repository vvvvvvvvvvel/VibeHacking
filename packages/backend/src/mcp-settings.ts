import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import { MCP_DEFAULT_HOST, MCP_DEFAULT_PORT, type McpSettings } from "shared";
import { z } from "zod";

import type { MCPSDK } from "./types/sdk";

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

export class McpSettingsStore {
    private readonly sdk: MCPSDK;
    private readonly settingsPath: string;
    private persistQueue: Promise<void> = Promise.resolve();
    private state: SettingsSnapshot;

    constructor(sdk: MCPSDK) {
        this.sdk = sdk;
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

    getSettings(endpointPath: string): McpSettings {
        const displayHost = this.state.host === "0.0.0.0" ? "127.0.0.1" : this.state.host;
        return {
            enabled: this.state.enabled,
            host: this.state.host,
            port: this.state.port,
            url: `http://${displayHost}:${this.state.port}${endpointPath}`,
        };
    }

    setEnabled(enabled: boolean) {
        this.state = { ...this.state, enabled };
    }

    overrideConfig(input: { host?: string; port?: number }) {
        const host = input.host ?? this.state.host;
        const port = input.port ?? this.state.port;
        const validated = this.validateConfig({ host, port });
        this.state = { ...this.state, ...validated };
    }

    setConfig(input: { host: string; port: number }) {
        const { host, port } = this.validateConfig(input);
        this.state = { ...this.state, host, port };
    }

    async load(): Promise<SettingsSnapshot | undefined> {
        try {
            const raw = await readFile(this.settingsPath, { encoding: "utf8" });
            const parsed = settingsSchema.safeParse(JSON.parse(String(raw)));
            if (!parsed.success) {
                return undefined;
            }
            const { enabled, host, port } = parsed.data;
            return {
                enabled: enabled ?? this.state.enabled,
                host: host ?? this.state.host,
                port: port ?? this.state.port,
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("no such file") || message.includes("ENOENT")) {
                await this.save();
                return undefined;
            }
            this.sdk.console.error(`Failed to read MCP settings: ${message}`);
            return undefined;
        }
    }

    save(): Promise<void> {
        this.persistQueue = this.persistQueue
            .then(() => this.saveInternal())
            .catch(() => undefined);
        return this.persistQueue;
    }

    private async saveInternal(): Promise<void> {
        const data = JSON.stringify(this.state, null, 2);
        await mkdir(this.sdk.meta.path(), { recursive: true });
        await writeFile(this.settingsPath, data);
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
