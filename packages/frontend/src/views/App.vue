<template>
    <div class="mcp-page">
        <div class="mcp-scroll">
            <header class="mcp-hero">
                <div class="mcp-title">
                    <p class="mcp-kicker">Settings</p>
                    <h1>Vibe Hacking</h1>
                    <p class="mcp-sub">
                        Manage the MCP server and client connections over Streamable HTTP.
                    </p>
                </div>
                <div class="mcp-status" :class="{ on: enabled }">
                    <span class="mcp-dot"></span>
                    <span>{{ statusText }}</span>
                </div>
            </header>

            <section class="mcp-panel">
                <div class="mcp-panel-head">
                    <div>
                        <h2>Server</h2>
                        <p>Manage MCP state and connection settings.</p>
                    </div>
                    <div class="server-actions">
                        <button
                            class="icon-btn icon-only"
                            type="button"
                            aria-controls="mcp-client-guide"
                            :aria-expanded="mcpGuideOpen"
                            aria-label="Toggle MCP client setup guide"
                            title="Client setup"
                            @click="mcpGuideOpen = !mcpGuideOpen"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                    d="M12 6.5v14"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linecap="round"
                                />
                                <path
                                    d="M4 4.5h5.2A2.8 2.8 0 0 1 12 7.3v13.2a3.5 3.5 0 0 0-2.8-1.4H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linejoin="round"
                                />
                                <path
                                    d="M20 4.5h-5.2A2.8 2.8 0 0 0 12 7.3v13.2a3.5 3.5 0 0 1 2.8-1.4H20a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1Z"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linejoin="round"
                                />
                            </svg>
                        </button>
                        <div class="mcp-switch">
                            <label class="simple-switch">
                                <input
                                    type="checkbox"
                                    :checked="enabled"
                                    :disabled="isLocked"
                                    @change="onSimpleToggle"
                                />
                                <span class="track">
                                    <span class="thumb"></span>
                                </span>
                            </label>
                        </div>
                    </div>
                </div>

                <div
                    v-if="mcpGuideOpen"
                    id="mcp-client-guide"
                    class="api-guide mcp-client-guide"
                    role="region"
                    aria-label="MCP client setup guide"
                >
                    <div class="api-guide__summary">
                        <span>Use the MCP URL below in your client.</span>
                        <span>Install the skill when the client supports Codex skills.</span>
                    </div>
                    <div class="api-guide__examples">
                        <div
                            v-for="example in clientGuideExamples"
                            :key="example.title"
                            class="api-guide__example"
                        >
                            <div class="api-guide__example-head">
                                <div>
                                    <div class="api-guide__method">{{ example.title }}</div>
                                    <div v-if="example.description" class="api-guide__description">
                                        {{ example.description }}
                                    </div>
                                </div>
                                <button
                                    class="icon-btn"
                                    type="button"
                                    @click="copyText(example.command, example.copyLabel)"
                                >
                                    Copy
                                </button>
                            </div>
                            <pre class="api-guide__code">{{ example.command }}</pre>
                        </div>
                    </div>
                    <div class="skill-link-row">
                        <div>
                            <div class="api-guide__method">Caido MCP skill</div>
                            <a
                                class="about-link skill-link-row__link"
                                :href="SKILL_URL"
                                target="_blank"
                                rel="noreferrer"
                            >
                                {{ SKILL_URL }}
                            </a>
                        </div>
                        <button
                            class="icon-btn"
                            type="button"
                            @click="copyText(SKILL_URL, 'Skill URL')"
                        >
                            Copy link
                        </button>
                    </div>
                </div>

                <div class="mcp-grid">
                    <div class="mcp-tile">
                        <div class="label">Status</div>
                        <div class="value">{{ statusLabel }}</div>
                        <div class="hint">{{ statusHint }}</div>
                    </div>
                    <div class="mcp-tile url-tile">
                        <div class="label">URL</div>
                        <div class="value mono url-value">{{ settings?.url ?? "—" }}</div>
                        <div class="hint url-hint">Streamable HTTP endpoint.</div>
                        <button
                            class="icon-btn icon-only copy-btn"
                            type="button"
                            :disabled="!settings"
                            aria-label="Copy URL"
                            @click="copyUrl"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                    d="M9 9a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V9zm-5 6V6a2 2 0 0 1 2-2h9"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                        </button>
                    </div>
                    <div class="mcp-tile">
                        <div class="label">Host</div>
                        <div class="value">
                            <input
                                v-model.trim="draftHost"
                                class="edit-input"
                                type="text"
                                :disabled="isLocked"
                                :placeholder="MCP_DEFAULT_HOST"
                            />
                        </div>
                        <div class="hint-row">
                            <span class="hint">Listening interface.</span>
                            <button
                                class="icon-btn"
                                type="button"
                                :disabled="isLocked"
                                @click="resetHost"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                    <div class="mcp-tile">
                        <div class="label">Port</div>
                        <div class="value">
                            <input
                                v-model.number="draftPort"
                                class="edit-input"
                                type="number"
                                min="1"
                                max="65535"
                                :disabled="isLocked"
                                :placeholder="String(MCP_DEFAULT_PORT)"
                            />
                        </div>
                        <div class="hint-row">
                            <span class="hint">MCP TCP port.</span>
                            <button
                                class="icon-btn"
                                type="button"
                                :disabled="isLocked"
                                @click="resetPort"
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                </div>

                <div class="api-control">
                    <div class="api-control__head">
                        <div>
                            <div class="label">API control</div>
                            <div class="hint">Localhost-only control endpoint.</div>
                        </div>
                        <button
                            class="icon-btn icon-only api-control__help-btn"
                            type="button"
                            aria-controls="api-control-guide"
                            :aria-expanded="apiGuideOpen"
                            aria-label="Toggle API control guide"
                            title="API control guide"
                            @click="apiGuideOpen = !apiGuideOpen"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                    d="M12 6.5v14"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linecap="round"
                                />
                                <path
                                    d="M4 4.5h5.2A2.8 2.8 0 0 1 12 7.3v13.2a3.5 3.5 0 0 0-2.8-1.4H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linejoin="round"
                                />
                                <path
                                    d="M20 4.5h-5.2A2.8 2.8 0 0 0 12 7.3v13.2a3.5 3.5 0 0 1 2.8-1.4H20a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1Z"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"
                                    stroke-linejoin="round"
                                />
                            </svg>
                        </button>
                    </div>
                    <div class="api-control__grid">
                        <div class="api-control__field">
                            <div class="label">URL</div>
                            <div class="api-control__value-row">
                                <div class="value mono api-control__value">
                                    {{ settings?.controlUrl ?? "—" }}
                                </div>
                                <button
                                    class="icon-btn icon-only"
                                    type="button"
                                    :disabled="!settings"
                                    aria-label="Copy API control URL"
                                    title="Copy URL"
                                    @click="copyControlUrl"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <path
                                            d="M9 9a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V9zm-5 6V6a2 2 0 0 1 2-2h9"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="1.6"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div
                        v-if="apiGuideOpen"
                        id="api-control-guide"
                        class="api-guide"
                        role="region"
                        aria-label="API control guide"
                    >
                        <div class="api-guide__summary">
                            <span>POST JSON to the control URL from localhost.</span>
                            <span>All responses use { ok, result | error }.</span>
                        </div>
                        <div class="api-guide__examples">
                            <div
                                v-for="example in apiGuideExamples"
                                :key="example.method"
                                class="api-guide__example"
                            >
                                <div class="api-guide__example-head">
                                    <div>
                                        <div class="api-guide__method">{{ example.method }}</div>
                                        <div class="api-guide__description">
                                            {{ example.description }}
                                        </div>
                                    </div>
                                    <button
                                        class="icon-btn"
                                        type="button"
                                        @click="copyText(example.command, `${example.method} curl`)"
                                    >
                                        Copy
                                    </button>
                                </div>
                                <pre class="api-guide__code">{{ example.command }}</pre>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="panel-actions">
                    <button
                        class="apply-btn"
                        type="button"
                        :disabled="!canApply || busy"
                        @click="applyConfig"
                    >
                        Apply
                    </button>
                </div>
            </section>

            <section class="mcp-panel">
                <div class="mcp-panel-head">
                    <div>
                        <h2>Tools</h2>
                        <p>Manage confirmation behavior for tool groups.</p>
                    </div>
                </div>

                <div v-if="!toolPermissions" class="tools-empty">Loading tool settings...</div>
                <div v-else class="tools-list">
                    <div class="tool-row">
                        <div class="tool-info">
                            <div class="tool-title">All groups</div>
                            <div class="tool-meta">
                                <span class="tool-tag">Applies to every group below</span>
                            </div>
                        </div>
                        <div class="tool-controls">
                            <details class="tool-dropdown" :class="{ busy: bulkBusy }">
                                <summary class="tool-dropdown__summary">
                                    <span>{{ bulkLabel }}</span>
                                    <span class="tool-dropdown__chevron" aria-hidden="true">▾</span>
                                </summary>
                                <div class="tool-dropdown__menu" role="listbox">
                                    <button
                                        v-for="option in toolModeOptions"
                                        :key="option.value"
                                        type="button"
                                        class="tool-dropdown__option"
                                        :class="{ active: bulkMode === option.value }"
                                        @click="onBulkModeSelect(option.value, $event)"
                                    >
                                        {{ option.label }}
                                    </button>
                                </div>
                            </details>
                        </div>
                    </div>
                    <div v-for="group in toolPermissions.groups" :key="group.id" class="tool-row">
                        <div class="tool-info">
                            <div class="tool-title">{{ group.label }}</div>
                            <div class="tool-meta">
                                <span
                                    v-for="tool in group.tools"
                                    :key="tool.action"
                                    class="tool-tag"
                                >
                                    {{ tool.name }}
                                </span>
                            </div>
                        </div>
                        <div class="tool-controls">
                            <details class="tool-dropdown" :class="{ busy: toolBusy[group.id] }">
                                <summary class="tool-dropdown__summary">
                                    <span>{{
                                        modeLabel(toolPermissions.states[group.id] ?? "confirm")
                                    }}</span>
                                    <span class="tool-dropdown__chevron" aria-hidden="true">▾</span>
                                </summary>
                                <div class="tool-dropdown__menu" role="listbox">
                                    <button
                                        v-for="option in toolModeOptions"
                                        :key="option.value"
                                        type="button"
                                        class="tool-dropdown__option"
                                        :class="{
                                            active:
                                                (toolPermissions.states[group.id] ?? 'confirm') ===
                                                option.value,
                                        }"
                                        @click="onToolModeSelect(group.id, option.value, $event)"
                                    >
                                        {{ option.label }}
                                    </button>
                                </div>
                            </details>
                        </div>
                    </div>
                </div>
            </section>

            <section class="mcp-about">
                <div>
                    <h3>About</h3>
                    <p>Vibe Hacking Plugin</p>
                    <p class="about-author">
                        Project:
                        <a
                            class="about-link"
                            href="https://github.com/vvvvvvvvvvel/AFL"
                            target="_blank"
                            rel="noreferrer"
                        >
                            GitHub
                        </a>
                    </p>
                    <p class="about-author">
                        Author:
                        <a
                            class="about-link"
                            href="https://github.com/vvvvvvvvvvel"
                            target="_blank"
                            rel="noreferrer"
                        >
                            vvvvvvvvvvel
                        </a>
                    </p>
                </div>
                <div class="meta">
                    <div>Version: {{ MCP_PLUGIN_VERSION }}</div>
                    <div>Runtime: Streamable HTTP</div>
                </div>
            </section>
        </div>
    </div>
</template>

<script setup lang="ts">
/* global document, navigator */
import {
    MCP_DEFAULT_HOST,
    MCP_DEFAULT_PORT,
    MCP_PLUGIN_VERSION,
    type McpSettings,
    type ToolGroupMode,
    type ToolPermissions,
} from "shared";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { FrontendSDK } from "@/types";

const { sdk } = defineProps<{
    sdk: FrontendSDK;
}>();

const settings = ref<McpSettings | undefined>(undefined);
const toolPermissions = ref<ToolPermissions | undefined>(undefined);
const toolBusy = ref<Record<string, boolean>>({});
const bulkBusy = ref(false);
const enabled = ref(false);
const loading = ref(true);
const busy = ref(false);
const draftHost = ref("");
const draftPort = ref<number | undefined>(undefined);
const mcpGuideOpen = ref(false);
const apiGuideOpen = ref(false);
const stopBackendEvents: Array<() => void> = [];
const SKILL_URL = "https://github.com/vvvvvvvvvvel/VibeHacking/blob/main/SKILL.md";
type ClientGuideExample = {
    title: string;
    description?: string;
    command: string;
    copyLabel: string;
};
const toolModeOptions: { value: ToolGroupMode; label: string }[] = [
    { value: "auto", label: "Auto run" },
    { value: "confirm", label: "Ask to confirm" },
    { value: "disabled", label: "Disabled" },
];

const isLocked = computed(() => loading.value || busy.value);

const statusText = computed(() => {
    if (loading.value) return "Loading";
    return enabled.value ? "Enabled" : "Disabled";
});

const statusLabel = computed(() => (enabled.value ? "MCP running" : "MCP stopped"));
const statusHint = computed(() =>
    enabled.value ? "MCP endpoint is accepting requests." : "API control remains available.",
);

const applySettings = (next: McpSettings) => {
    settings.value = next;
    enabled.value = next.enabled;
    draftHost.value = next.host;
    draftPort.value = next.port;
};

const initializeServer = async () => {
    try {
        await sdk.backend.initializeMcpServer();
    } catch (err) {
        sdk.window.showToast(`Failed to initialize MCP.\n${err}`, {
            variant: "error",
        });
    }
};

const fetchSettings = async () => {
    try {
        const next = await sdk.backend.getMcpServerSettings();
        applySettings(next);
    } catch (err) {
        sdk.window.showToast(`Failed to load MCP settings.\n${err}`, {
            variant: "error",
        });
    } finally {
        loading.value = false;
    }
};

const fetchToolPermissions = async () => {
    try {
        toolPermissions.value = await sdk.backend.getToolGroupPermissionModes();
    } catch (err) {
        sdk.window.showToast(`Failed to load tool settings.\n${err}`, {
            variant: "error",
        });
    }
};

const registerBackendStateEvents = () => {
    if (stopBackendEvents.length > 0) return;
    stopBackendEvents.push(
        sdk.backend.onEvent("vibe-hacking:mcp-server-settings-changed", (next) => {
            applySettings(next);
        }).stop,
    );
    stopBackendEvents.push(
        sdk.backend.onEvent("vibe-hacking:tool-group-permission-modes-changed", (next) => {
            toolPermissions.value = next;
        }).stop,
    );
};

const onToolModeSelect = (groupId: string, mode: ToolGroupMode, event: Event) => {
    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
        const details = target.closest("details");
        if (details) details.removeAttribute("open");
    }
    void updateToolGroupMode(groupId, mode);
};

const modeLabel = (mode: ToolGroupMode) =>
    toolModeOptions.find((option) => option.value === mode)?.label ?? "Ask to confirm";

const bulkMode = computed<ToolGroupMode | undefined>(() => {
    const perms = toolPermissions.value;
    if (!perms || perms.groups.length === 0) return undefined;
    const firstGroup = perms.groups[0];
    if (firstGroup === undefined) return undefined;
    const first = perms.states[firstGroup.id] ?? "confirm";
    const allSame = perms.groups.every((group) => (perms.states[group.id] ?? "confirm") === first);
    return allSame ? first : undefined;
});

const bulkLabel = computed(() => {
    const mode = bulkMode.value;
    if (mode === undefined) return "Mixed";
    return modeLabel(mode);
});

const onBulkModeSelect = (mode: ToolGroupMode, event: Event) => {
    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
        const details = target.closest("details");
        if (details) details.removeAttribute("open");
    }
    void applyBulkMode(mode);
};

const applyBulkMode = async (mode: ToolGroupMode) => {
    const perms = toolPermissions.value;
    if (!perms || bulkBusy.value) return;
    bulkBusy.value = true;
    const groupIds = perms.groups.map((group) => group.id);
    const nextBusy = { ...toolBusy.value };
    for (const id of groupIds) nextBusy[id] = true;
    toolBusy.value = nextBusy;
    try {
        toolPermissions.value = await sdk.backend.setAllToolGroupPermissionModes(mode);
    } catch (err) {
        sdk.window.showToast(`Failed to update tool groups.\n${err}`, {
            variant: "error",
        });
    } finally {
        const clearedBusy = { ...toolBusy.value };
        for (const id of groupIds) clearedBusy[id] = false;
        toolBusy.value = clearedBusy;
        bulkBusy.value = false;
    }
};

const updateToolGroupMode = async (groupId: string, mode: ToolGroupMode) => {
    toolBusy.value = { ...toolBusy.value, [groupId]: true };
    try {
        toolPermissions.value = await sdk.backend.setToolGroupPermissionMode(groupId, mode);
    } catch (err) {
        sdk.window.showToast(`Failed to update tool group.\n${err}`, {
            variant: "error",
        });
    } finally {
        toolBusy.value = { ...toolBusy.value, [groupId]: false };
    }
};

const handleOutsideClick = (event: MouseEvent) => {
    const doc = typeof document === "undefined" ? undefined : document;
    if (doc === undefined) return;
    const target = event.target;
    const openMenus = doc.querySelectorAll("details.tool-dropdown[open]");
    openMenus.forEach((menu) => {
        if (target instanceof Node && menu.contains(target)) return;
        menu.removeAttribute("open");
    });
};

const onSimpleToggle = (event: Event) => {
    const target = event.target;
    const next = target instanceof HTMLInputElement ? target.checked : !enabled.value;
    void onToggle(next);
};

const resetHost = () => {
    if (settings.value === undefined || settings.value === null) return;
    draftHost.value = settings.value.host;
};

const resetPort = () => {
    if (settings.value === undefined || settings.value === null) return;
    draftPort.value = settings.value.port;
};

const copyText = async (value: string | undefined, label: string) => {
    if (value === undefined || value === "") return;
    try {
        if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
            sdk.window.showToast("Clipboard is not available.", { variant: "error" });
            return;
        }
        await navigator.clipboard.writeText(value);
        sdk.window.showToast(`${label} copied.`, { variant: "success" });
    } catch {
        sdk.window.showToast(`Failed to copy ${label.toLowerCase()}.`, { variant: "error" });
    }
};

const copyUrl = async () => {
    await copyText(settings.value?.url, "URL");
};

const copyControlUrl = async () => {
    await copyText(settings.value?.controlUrl, "API control URL");
};

const mcpUrl = computed(() => settings.value?.url ?? "http://127.0.0.1:3333/mcp");
const controlUrl = computed(() => settings.value?.controlUrl ?? "http://127.0.0.1:3333/control");

const controlCurl = (payload: string) =>
    `curl -sS -X POST "${controlUrl.value}" -H "content-type: application/json" -d '${payload}'`;

const clientGuideExamples = computed<ClientGuideExample[]>(() => [
    {
        title: "Codex",
        command: `codex mcp add caido --url ${mcpUrl.value}`,
        copyLabel: "Codex command",
    },
    {
        title: "Claude",
        command: `claude mcp add --transport http caido ${mcpUrl.value}`,
        copyLabel: "Claude command",
    },
]);

const apiGuideExamples = computed(() => [
    {
        method: "getMcpServerSettings",
        description: "Read MCP enabled state, host, port, MCP URL, and control URL.",
        command: controlCurl('{"method":"getMcpServerSettings"}'),
    },
    {
        method: "setMcpServerEnabled",
        description: "Enable or disable the MCP endpoint while keeping control available.",
        command: controlCurl('{"method":"setMcpServerEnabled","params":{"enabled":true}}'),
    },
    {
        method: "updateMcpServerConfig",
        description: "Change MCP bind host and TCP port.",
        command: controlCurl(
            '{"method":"updateMcpServerConfig","params":{"host":"127.0.0.1","port":3333}}',
        ),
    },
    {
        method: "getToolGroupPermissionModes",
        description: "Read visible tool groups and their current modes.",
        command: controlCurl('{"method":"getToolGroupPermissionModes"}'),
    },
    {
        method: "setToolGroupPermissionMode",
        description: "Set one visible tool group to auto, confirm, or disabled.",
        command: controlCurl(
            '{"method":"setToolGroupPermissionMode","params":{"groupId":"request-safe","mode":"confirm"}}',
        ),
    },
    {
        method: "setAllToolGroupPermissionModes",
        description: "Apply one mode to every visible tool group.",
        command: controlCurl(
            '{"method":"setAllToolGroupPermissionModes","params":{"mode":"disabled"}}',
        ),
    },
]);

const canApply = computed(() => {
    if (settings.value === undefined || settings.value === null) return false;
    if (draftHost.value.trim() === "" || draftPort.value === undefined) return false;
    return (
        draftHost.value.trim() !== settings.value.host || draftPort.value !== settings.value.port
    );
});

const applyConfig = async () => {
    if (settings.value === undefined || settings.value === null || !canApply.value) {
        return;
    }
    busy.value = true;
    try {
        const next = await sdk.backend.updateMcpServerConfig({
            host: draftHost.value.trim(),
            port: Number(draftPort.value),
        });
        applySettings(next);
        sdk.window.showToast("Configuration applied.", {
            variant: "success",
        });
    } catch (err) {
        const message =
            err instanceof Error ? err.message : `Failed to apply configuration.\n${err}`;
        sdk.window.showToast(message, {
            variant: "error",
        });
    } finally {
        busy.value = false;
    }
};

const onToggle = async (value: boolean) => {
    if (settings.value === undefined || settings.value === null || busy.value === true) {
        return;
    }
    const previous = enabled.value;
    enabled.value = value;
    busy.value = true;
    try {
        const next = await sdk.backend.setMcpServerEnabled(value);
        applySettings(next);
        sdk.window.showToast(next.enabled ? "MCP server enabled." : "MCP server disabled.", {
            variant: "success",
        });
    } catch (err) {
        enabled.value = previous;
        sdk.window.showToast(`Failed to update MCP status.\n${err}`, {
            variant: "error",
        });
    } finally {
        busy.value = false;
    }
};

onMounted(async () => {
    registerBackendStateEvents();
    await initializeServer();
    await Promise.all([fetchSettings(), fetchToolPermissions()]);
    const doc = typeof document === "undefined" ? undefined : document;
    if (doc !== undefined) {
        doc.addEventListener("click", handleOutsideClick);
    }
});

onBeforeUnmount(() => {
    while (stopBackendEvents.length > 0) {
        stopBackendEvents.pop()?.();
    }
    const doc = typeof document === "undefined" ? undefined : document;
    if (doc !== undefined) {
        doc.removeEventListener("click", handleOutsideClick);
    }
});
</script>
