import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import type { ToolGroup, ToolGroupMode, ToolGroupTool, ToolPermissions } from "shared";

import type { MCPSDK } from "./types/sdk";

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
    ProxyPassthroughSafe = "proxy-passthrough-safe",
    ProxyPassthroughUnsafe = "proxy-passthrough-unsafe",
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
        id: ToolGroupId.ProxyPassthroughSafe,
        label: "Proxy passthrough safe",
        tools: [],
        defaultMode: "auto",
    },
    {
        id: ToolGroupId.ProxyPassthroughUnsafe,
        label: "Proxy passthrough unsafe",
        tools: [],
        defaultMode: "confirm",
    },
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
const HIDDEN_GROUP_IDS = new Set<string>([]);

const createBaseGroups = (): ToolGroup[] =>
    BASE_GROUPS.map(({ id, label, tools }) => ({
        id,
        label,
        tools: tools.map((tool) => ({ ...tool })),
    }));

const createDefaultStates = (): Record<string, ToolGroupMode> =>
    Object.fromEntries(BASE_GROUPS.map((group) => [group.id, group.defaultMode]));

const groupIds = new Set<string>(BASE_GROUPS.map((group) => group.id));
const visibleGroupIds = new Set<string>(
    BASE_GROUPS.filter((group) => !HIDDEN_GROUP_IDS.has(group.id)).map((group) => group.id),
);

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
        return { states: next, migrated: false };
    }
    const input = states as Record<string, unknown>;
    let migrated = false;
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
    private readonly permissionsPath: string;
    private persistQueue: Promise<void> = Promise.resolve();
    private groups: ToolGroup[] = createBaseGroups();
    private states: Record<string, ToolGroupMode> = createDefaultStates();
    private actionToGroup: Record<string, ToolGroupId> = {};

    constructor(sdk: MCPSDK) {
        this.sdk = sdk;
        this.permissionsPath = join(this.sdk.meta.path(), "tool-permissions.json");
    }

    async load(): Promise<void> {
        try {
            const raw = await readFile(this.permissionsPath, { encoding: "utf8" });
            const parsed = JSON.parse(String(raw)) as ToolPermissions;
            this.groups = createBaseGroups();
            const merged = mergeKnownStates(parsed?.states);
            this.states = merged.states;
            if (merged.migrated) {
                await this.save();
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!message.includes("no such file") && !message.includes("ENOENT")) {
                this.sdk.console.error(`Failed to read tool permissions: ${message}`);
            }
            await this.save();
        }
    }

    getPermissions(): ToolPermissions {
        return {
            groups: this.groups.filter((group) => !HIDDEN_GROUP_IDS.has(group.id)),
            states: Object.fromEntries(
                Object.entries(this.states).filter(([groupId]) => visibleGroupIds.has(groupId)),
            ),
        };
    }

    getModeForAction(action: string): ToolGroupMode {
        const groupId = this.actionToGroup[action];
        const group = this.groups.find((g) => g.id === groupId);
        if (!group) return DEFAULT_MODE;
        if (HIDDEN_GROUP_IDS.has(group.id)) return "auto";
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

    async setGroupMode(groupId: string, mode: ToolGroupMode): Promise<ToolPermissions> {
        if (!visibleGroupIds.has(groupId)) {
            throw new Error(`Unknown tool group: ${groupId}`);
        }
        if (!isToolGroupMode(mode)) {
            throw new Error(`Invalid tool group mode: ${String(mode)}`);
        }
        this.states = { ...this.states, [groupId]: mode };
        await this.save();
        return this.getPermissions();
    }

    async setAllGroupModes(mode: ToolGroupMode): Promise<ToolPermissions> {
        if (!isToolGroupMode(mode)) {
            throw new Error(`Invalid tool group mode: ${String(mode)}`);
        }
        const nextStates = { ...this.states };
        for (const group of this.groups) {
            nextStates[group.id] = HIDDEN_GROUP_IDS.has(group.id) ? "auto" : mode;
        }
        this.states = nextStates;
        await this.save();
        return this.getPermissions();
    }

    private save(): Promise<void> {
        this.persistQueue = this.persistQueue
            .then(() => this.saveInternal())
            .catch(() => undefined);
        return this.persistQueue;
    }

    private async saveInternal(): Promise<void> {
        await mkdir(this.sdk.meta.path(), { recursive: true });
        const data: ToolPermissions = {
            groups: this.groups,
            states: this.states,
        };
        await writeFile(this.permissionsPath, JSON.stringify(data, null, 2));
    }
}
