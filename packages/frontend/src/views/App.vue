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
const enabled = ref(false);
const loading = ref(true);
const busy = ref(false);
const draftHost = ref("");
const draftPort = ref<number | undefined>(undefined);
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

const statusLabel = computed(() => (enabled.value ? "Running" : "Stopped"));
const statusHint = computed(() =>
    enabled.value ? "Server is accepting requests." : "Server is stopped.",
);

const applySettings = (next: McpSettings) => {
    settings.value = next;
    enabled.value = next.enabled;
    draftHost.value = next.host;
    draftPort.value = next.port;
};

const initialize = async () => {
    try {
        await sdk.backend.initialize();
    } catch (err) {
        sdk.window.showToast(`Failed to initialize MCP.\n${err}`, {
            variant: "error",
        });
    }
};

const fetchSettings = async () => {
    try {
        const next = await sdk.backend.getSettings();
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
        toolPermissions.value = await sdk.backend.getToolPermissions();
    } catch (err) {
        sdk.window.showToast(`Failed to load tool settings.\n${err}`, {
            variant: "error",
        });
    }
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

const updateToolGroupMode = async (groupId: string, mode: ToolGroupMode) => {
    toolBusy.value = { ...toolBusy.value, [groupId]: true };
    try {
        toolPermissions.value = await sdk.backend.setToolGroupMode(groupId, mode);
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

const copyUrl = async () => {
    if (settings.value === undefined || settings.value === null) return;
    try {
        if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
            sdk.window.showToast("Clipboard is not available.", { variant: "error" });
            return;
        }
        await navigator.clipboard.writeText(settings.value.url);
        sdk.window.showToast("URL copied.", { variant: "success" }); //
    } catch {
        sdk.window.showToast("Failed to copy URL.", { variant: "error" });
    }
};

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
        const next = await sdk.backend.setConfig({
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
        const next = await sdk.backend.setEnabled(value);
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
    void (await initialize());
    void (await fetchSettings());
    void (await fetchToolPermissions());
    const doc = typeof document === "undefined" ? undefined : document;
    if (doc !== undefined) {
        doc.addEventListener("click", handleOutsideClick);
    }
});

onBeforeUnmount(() => {
    const doc = typeof document === "undefined" ? undefined : document;
    if (doc !== undefined) {
        doc.removeEventListener("click", handleOutsideClick);
    }
});
</script>
