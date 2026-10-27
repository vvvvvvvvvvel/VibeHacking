import { readFile, writeFile } from "fs/promises";
import { join } from "path";

import type { ToolGroup, ToolGroupMode, ToolGroupTool, ToolPermissions } from "shared";

import { getKvSdk, type KVSDK, type MCPSDK } from "./types/sdk";

export enum ToolGroupId {
    LogSafe = "group-log",
    EnvSafe = "env-safe",
    EnvUnsafe = "env-unsafe",
    FilterSafe = "filter-safe",
    FilterUnsafe = "filter-unsafe",
    FindingSafe = "finding-safe",
    FindingUnsafe = "finding-unsafe",
    HostedFileSafe = "hosted-file-safe",
    HostedFileUnsafe = "hosted-file-unsafe",
    ProxyTrafficControlSafe = "proxy-traffic-control-safe",
    ProxyTrafficControlUnsafe = "proxy-traffic-control-unsafe",
    AutomateSafe = "automate-safe",
    ProjectSafe = "project-safe",
    ReplaySafe = "replay-safe",
    ReplayUnsafe = "replay-unsafe",
    RequestSafe = "request-safe",
    RequestUnsafe = "request-unsafe",
    RuntimeSafe = "runtime-safe",
    SitemapSafe = "sitemap-safe",
    ScopeSafe = "scope-safe",
    ScopeUnsafe = "scope-unsafe",
    TamperSafe = "tamper-safe",
    TamperUnsafe = "tamper-unsafe",
    WsSafe = "ws-safe",
}

type ToolGroupSeed = ToolGroup & { defaultMode: ToolGroupMode };

const BASE_GROUPS: ToolGroupSeed[] = [
    {
        id: ToolGroupId.LogSafe,
        label: "Log",
        tools: [],
        defaultMode: "disabled",
    },
    { id: ToolGroupId.EnvSafe, label: "Env safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.EnvUnsafe, label: "Env unsafe", tools: [], defaultMode: "confirm" },
    { id: ToolGroupId.FilterSafe, label: "Filter safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.FilterUnsafe, label: "Filter unsafe", tools: [], defaultMode: "confirm" },
    { id: ToolGroupId.FindingSafe, label: "Finding safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.FindingUnsafe, label: "Finding unsafe", tools: [], defaultMode: "confirm" },
    { id: ToolGroupId.HostedFileSafe, label: "HostedFile safe", tools: [], defaultMode: "auto" },
    {
        id: ToolGroupId.HostedFileUnsafe,
        label: "HostedFile unsafe",
        tools: [],
        defaultMode: "confirm",
    },
    {
        id: ToolGroupId.ProxyTrafficControlSafe,
        label: "Proxy traffic control safe",
        tools: [],
        defaultMode: "auto",
    },
    {
        id: ToolGroupId.ProxyTrafficControlUnsafe,
        label: "Proxy traffic control unsafe",
        tools: [],
        defaultMode: "confirm",
    },
    { id: ToolGroupId.AutomateSafe, label: "Automate", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ProjectSafe, label: "Project info", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ReplaySafe, label: "Replay safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ReplayUnsafe, label: "Replay unsafe", tools: [], defaultMode: "confirm" },
    { id: ToolGroupId.RequestSafe, label: "Request safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.RequestUnsafe, label: "Request unsafe", tools: [], defaultMode: "confirm" },
    { id: ToolGroupId.RuntimeSafe, label: "Runtime info", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.SitemapSafe, label: "Sitemap", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ScopeSafe, label: "Scope safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ScopeUnsafe, label: "Scope unsafe", tools: [], defaultMode: "confirm" },
    {
        id: ToolGroupId.TamperSafe,
        label: "Tamper (Match & Replace) safe",
        tools: [],
        defaultMode: "auto",
    },
    {
        id: ToolGroupId.TamperUnsafe,
        label: "Tamper (Match & Replace) unsafe",
        tools: [],
        defaultMode: "confirm",
    },
    { id: ToolGroupId.WsSafe, label: "WS History", tools: [], defaultMode: "auto" },
];

const DEFAULT_MODE: ToolGroupMode = "confirm";
const TOOL_PERMISSIONS_KEY = "mcp-tool-permissions";

const createBaseGroups = (): ToolGroup[] =>
    BASE_GROUPS.map(({ id, label, tools }) => ({
        id,
        label,
        tools: tools.map((tool) => ({ ...tool })),
    }));

const createDefaultStates = (): Record<string, ToolGroupMode> =>
    Object.fromEntries(BASE_GROUPS.map((group) => [group.id, group.defaultMode]));

const groupIds = new Set<string>(BASE_GROUPS.map((group) => group.id));

const LEGACY_GROUP_ID_MIGRATIONS: Record<string, ToolGroupId> = {
    "temper-safe": ToolGroupId.TamperSafe,
    "temper-unsafe": ToolGroupId.TamperUnsafe,
};

const isToolGroupMode = (value: unknown): value is ToolGroupMode =>
    value === "auto" || value === "confirm" || value === "disabled";

const hasValidState = (states: Record<string, unknown>, groupId: string) =>
    isToolGroupMode(states[groupId]);

const mergeKnownStates = (
    states: unknown,
): { states: Record<string, ToolGroupMode>; migrated: boolean } => {
    const next = createDefaultStates();
    if (states === null || typeof states !== "object" || Array.isArray(states)) {
        return { states: next, migrated: true };
    }
    const input = states as Record<string, unknown>;
    let migrated = Object.entries(input).some(
        ([groupId, mode]) => !groupIds.has(groupId) || !isToolGroupMode(mode),
    );
    for (const [groupId, mode] of Object.entries(input)) {
        if (groupIds.has(groupId) && isToolGroupMode(mode)) {
            next[groupId] = mode;
        }
    }
    for (const [groupId, mode] of Object.entries(input)) {
        const migratedGroupId = LEGACY_GROUP_ID_MIGRATIONS[groupId];
        if (migratedGroupId === undefined) continue;
        migrated = true;
        if (!isToolGroupMode(mode)) continue;
        if (!hasValidState(input, migratedGroupId)) {
            next[migratedGroupId] = mode;
        }
    }
    return { states: next, migrated };
};

export class ToolPermissionsStore {
    private readonly sdk: MCPSDK;
    private readonly kv: KVSDK;
    private readonly permissionsPath: string;
    private keyDefined = false;
    private persistQueue: Promise<void> = Promise.resolve();
    private mutationQueue: Promise<void> = Promise.resolve();
    private groups: ToolGroup[] = createBaseGroups();
    private states: Record<string, ToolGroupMode> = createDefaultStates();
    private actionToGroup: Record<string, ToolGroupId> = {};

    constructor(sdk: MCPSDK) {
        this.sdk = sdk;
        this.kv = getKvSdk(sdk);
        this.permissionsPath = join(this.sdk.meta.path(), "tool-permissions.json");
    }

    async load(): Promise<void> {
        await this.defineKey();
        try {
            const stored = await this.kv.get(TOOL_PERMISSIONS_KEY);
            if (stored !== null && stored !== undefined) {
                const migrated = this.applyStoredPermissions(stored);
                if (migrated) await this.save();
                await this.clearLegacyFile();
                return;
            }
        } catch (err) {
            this.sdk.console.error(`Failed to read tool permissions from KV: ${this.message(err)}`);
            throw err;
        }

        try {
            const raw = await readFile(this.permissionsPath, { encoding: "utf8" });
            this.applyStoredPermissions(JSON.parse(String(raw)) as unknown);
            await this.save();
            await this.clearLegacyFile();
        } catch (err) {
            const message = this.message(err);
            if (!this.isMissingFileError(message)) {
                this.sdk.console.error(`Failed to migrate legacy tool permissions: ${message}`);
            }
            await this.save();
            await this.clearLegacyFile();
        }
    }

    getPermissions(): ToolPermissions {
        return {
            groups: this.groups.map((group) => ({
                ...group,
                tools: group.tools.map((tool) => ({ ...tool })),
            })),
            states: { ...this.states },
        };
    }

    getModeForAction(action: string): ToolGroupMode {
        const groupId = this.actionToGroup[action];
        const group = this.groups.find((g) => g.id === groupId);
        if (!group) return DEFAULT_MODE;
        return this.states[group.id] ?? DEFAULT_MODE;
    }

    registerTool(action: string, groupId: ToolGroupId, name: string) {
        const group = this.groups.find((g) => g.id === groupId);
        if (!group) return;
        this.actionToGroup[action] = groupId;
        const existing = group.tools.find((tool) => tool.action === action);
        const nextTool: ToolGroupTool = { action, name };
        group.tools = existing
            ? group.tools.map((tool) => (tool.action === action ? nextTool : tool))
            : [...group.tools, nextTool];
    }

    setGroupMode(groupId: string, mode: ToolGroupMode): Promise<ToolPermissions> {
        return this.enqueueMutation(async () => {
            if (!groupIds.has(groupId)) {
                throw new Error(`Unknown tool group: ${groupId}`);
            }
            if (!isToolGroupMode(mode)) {
                throw new Error(`Invalid tool group mode: ${String(mode)}`);
            }
            const previous = this.states;
            this.states = { ...this.states, [groupId]: mode };
            try {
                await this.save();
            } catch (error) {
                this.states = previous;
                throw error;
            }
            return this.getPermissions();
        });
    }

    setAllGroupModes(mode: ToolGroupMode): Promise<ToolPermissions> {
        return this.enqueueMutation(async () => {
            if (!isToolGroupMode(mode)) {
                throw new Error(`Invalid tool group mode: ${String(mode)}`);
            }
            const nextStates = { ...this.states };
            for (const group of this.groups) {
                nextStates[group.id] = mode;
            }
            const previous = this.states;
            this.states = nextStates;
            try {
                await this.save();
            } catch (error) {
                this.states = previous;
                throw error;
            }
            return this.getPermissions();
        });
    }

    private save(): Promise<void> {
        const operation = this.persistQueue.then(() => this.saveInternal());
        this.persistQueue = operation.catch(() => undefined);
        return operation;
    }

    private async saveInternal(): Promise<void> {
        await this.defineKey();
        await this.kv.set(TOOL_PERMISSIONS_KEY, { states: this.states });
    }

    private async defineKey() {
        if (this.keyDefined) return;
        await this.kv.define(TOOL_PERMISSIONS_KEY, { exportable: true });
        this.keyDefined = true;
    }

    private applyStoredPermissions(value: unknown) {
        const parsed =
            value !== null && typeof value === "object" && !Array.isArray(value)
                ? (value as { states?: unknown })
                : {};
        this.groups = createBaseGroups();
        const merged = mergeKnownStates(parsed.states);
        this.states = merged.states;
        return merged.migrated;
    }

    private async clearLegacyFile() {
        try {
            await readFile(this.permissionsPath);
            await writeFile(this.permissionsPath, "{}\n");
        } catch (err) {
            const message = this.message(err);
            if (!this.isMissingFileError(message)) {
                this.sdk.console.error(`Failed to clear legacy tool permissions: ${message}`);
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

    private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutationQueue.then(operation);
        this.mutationQueue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}
