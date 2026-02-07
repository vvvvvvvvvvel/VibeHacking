<template>
    <div class="mcp-dialog">
        <div class="mcp-dialog__header">
            <p class="mcp-dialog__kicker">{{ kicker }}</p>
            <h2 class="mcp-dialog__title">{{ title }}</h2>
        </div>
        <p v-if="message" class="mcp-dialog__text mcp-dialog__action">
            {{ message }}
        </p>
        <div v-if="hasDetails" class="mcp-dialog__details">
            <button
                data-mcp-details-toggle
                class="mcp-dialog__details-toggle"
                type="button"
                @click.stop="toggleDetails"
            >
                <span>{{ detailsTitle }}</span>
                <span data-mcp-details-chevron class="mcp-dialog__details-chevron">
                    {{ detailsOpen ? "▾" : "▸" }}
                </span>
            </button>
            <div v-show="detailsOpen" data-mcp-details-body class="mcp-dialog__details-body">
                <div v-for="(line, idx) in detailLines" :key="idx" class="mcp-dialog__details-line">
                    {{ line }}
                </div>
            </div>
        </div>
        <div class="mcp-dialog__actions">
            <button
                v-if="showCancel"
                class="mcp-dialog__btn"
                type="button"
                @click="$emit('cancel')"
            >
                {{ cancelText }}
            </button>
            <button class="mcp-dialog__btn primary" type="button" @click="$emit('ok')">
                {{ okText }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

const {
    title = "Test dialog",
    message = "",
    kicker = "Prompt",
    details = "",
    detailsTitle = "Details",
    okText = "OK",
    cancelText = "Cancel",
    showCancel = true,
} = defineProps<{
    title?: string;
    message?: string;
    kicker?: string;
    details?: string;
    detailsTitle?: string;
    okText?: string;
    cancelText?: string;
    showCancel?: boolean;
}>();
defineEmits<{ ok: []; cancel: [] }>();

const detailsOpen = ref(false);
const detailLines = computed(() => {
    if (details === undefined || details === "") return [] as string[];
    return String(details).split("\n");
});
const hasDetails = computed(() => detailLines.value.length > 0);

const toggleDetails = () => {
    detailsOpen.value = !detailsOpen.value;
};
</script>

<style src="../styles/dialog.css"></style>
