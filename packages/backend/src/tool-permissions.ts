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
    ProjectSafe = "project-safe",
    ReplaySafe = "replay-safe",
    ReplayUnsafe = "replay-unsafe",
    RequestSafe = "request-safe",
    RequestUnsafe = "request-unsafe",
    RuntimeSafe = "runtime-safe",
    ScopeSafe = "scope-safe",
    ScopeUnsafe = "scope-unsafe",
    TemperSafe = "temper-safe",
    TemperUnsafe = "temper-unsafe",
    WsSafe = "ws-safe",
    HelpSafe = "help-safe",
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
    { id: ToolGroupId.ProjectSafe, label: "Project info", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ReplaySafe, label: "Replay safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ReplayUnsafe, label: "Replay unsafe", tools: [], defaultMode: "confirm" },
    { id: ToolGroupId.RequestSafe, label: "Request safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.RequestUnsafe, label: "Request unsafe", tools: [], defaultMode: "confirm" },
    { id: ToolGroupId.RuntimeSafe, label: "Runtime info", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ScopeSafe, label: "Scope safe", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.ScopeUnsafe, label: "Scope unsafe", tools: [], defaultMode: "confirm" },
    {
        id: ToolGroupId.TemperSafe,
        label: "Tamper (Match & Replace) safe",
        tools: [],
        defaultMode: "auto",
    },
    {
        id: ToolGroupId.TemperUnsafe,
        label: "Tamper (Match & Replace) unsafe",
        tools: [],
        defaultMode: "confirm",
    },
    { id: ToolGroupId.WsSafe, label: "WS History", tools: [], defaultMode: "auto" },
    { id: ToolGroupId.HelpSafe, label: "Help", tools: [], defaultMode: "auto" },
];

const DEFAULT_MODE: ToolGroupMode = "confirm";
const HIDDEN_GROUP_IDS = new Set<string>([ToolGroupId.HelpSafe]);

export class ToolPermissionsStore {
    private readonly sdk: MCPSDK;
    private readonly permissionsPath: string;
    private persistQueue: Promise<void> = Promise.resolve();
    private groups: ToolGroup[] = BASE_GROUPS;
    private states: Record<string, ToolGroupMode> = {};
    private actionToGroup: Record<string, ToolGroupId> = {};

    constructor(sdk: MCPSDK) {
        this.sdk = sdk;
        this.permissionsPath = join(this.sdk.meta.path(), "tool-permissions.json");
        for (const group of BASE_GROUPS) {
            this.states[group.id] = group.defaultMode ?? DEFAULT_MODE;
        }
    }

    async load(): Promise<void> {
        try {
            const raw = await readFile(this.permissionsPath, { encoding: "utf8" });
            const parsed = JSON.parse(String(raw)) as ToolPermissions;
            this.groups = BASE_GROUPS.map((group) => ({
                id: group.id,
                label: group.label,
                tools: Array.from(new Map(group.tools.map((tool) => [tool.action, tool])).values()),
            }));
            if (parsed !== undefined && parsed.states !== undefined) {
                this.states = { ...this.states, ...parsed.states };
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
            states: this.states,
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
        if (HIDDEN_GROUP_IDS.has(groupId)) {
            this.states = { ...this.states, [groupId]: "auto" };
            return this.getPermissions();
        }
        this.states = { ...this.states, [groupId]: mode };
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
