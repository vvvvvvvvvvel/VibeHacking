import QDialog from "@/components/QDialog.vue";
import dialogCss from "@/styles/dialog.css?raw";
import type { FrontendSDK } from "@/types";

const DIALOG_ROOT_SELECTOR = '[data-pc-name="dialog"][data-pc-section="root"]';
const DIALOG_CONTENT_SELECTOR = ".mcp-dialog";
const DETAILS_TOGGLE_SELECTOR = "[data-mcp-details-toggle]";
const DETAILS_BODY_SELECTOR = "[data-mcp-details-body]";
const DETAILS_CHEVRON_SELECTOR = "[data-mcp-details-chevron]";
const DIALOG_STYLE_ID = "mcp-dialog-styles";
type DialogHandle = ReturnType<FrontendSDK["window"]["showDialog"]>;

const DEFAULT_DIALOG_OPTIONS: Record<string, unknown> = {
    title: "",
    modal: true,
    closable: false,
    draggable: false,
    closeOnEscape: false,
    position: "center",
};

type QDialogOptions = {
    title?: string;
    message?: string;
    kicker?: string;
    details?: string;
    detailsTitle?: string;
    okText?: string;
    cancelText?: string;
    showCancel?: boolean;
    closeOnMask?: boolean;
    onOk?: () => void;
    onCancel?: () => void;
};

const applyRootChrome = (root: HTMLElement) => {
    root.classList.add("mcp-dialog-root");
};

const applyMaskChrome = (mask?: HTMLElement) => {
    if (mask === undefined) return;
    mask.classList.add("mcp-dialog-mask");
};

const attachDetailsFallback = (root: HTMLElement) => {
    const detailsToggle = root.querySelector(DETAILS_TOGGLE_SELECTOR);
    const detailsBody = root.querySelector(DETAILS_BODY_SELECTOR);
    const detailsChevron = root.querySelector(DETAILS_CHEVRON_SELECTOR);
    if (!(detailsToggle instanceof HTMLButtonElement)) return;
    if (!(detailsBody instanceof HTMLElement)) return;
    if (detailsToggle.dataset.mcpDetailsBound !== undefined) return;
    detailsToggle.dataset.mcpDetailsBound = "true";
    detailsBody.style.display = "none";
    if (detailsChevron instanceof HTMLElement) detailsChevron.textContent = "▸";
    detailsToggle.setAttribute("aria-expanded", "false");
    detailsToggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isOpen = detailsBody.style.display !== "none";
        detailsBody.style.display = isOpen ? "none" : "block";
        detailsToggle.setAttribute("aria-expanded", String(!isOpen));
        if (detailsChevron instanceof HTMLElement) detailsChevron.textContent = isOpen ? "▸" : "▾";
    });
};

const ensureDialogStyles = (container: Document | ShadowRoot = document) => {
    const existing =
        container instanceof Document
            ? container.getElementById(DIALOG_STYLE_ID)
            : container.querySelector(`#${DIALOG_STYLE_ID}`);
    if (existing) return;
    const style = document.createElement("style");
    style.id = DIALOG_STYLE_ID;
    style.textContent = dialogCss;
    if (container instanceof ShadowRoot) {
        container.appendChild(style);
        return;
    }
    container.head.appendChild(style);
};

const attachMaskClose = (
    root: HTMLElement,
    mask: HTMLElement | undefined,
    dialog: DialogHandle | undefined,
    onMaskClose?: () => void,
) => {
    if (mask === undefined || dialog === undefined) return;
    const handler = (event: MouseEvent) => {
        const target = event.target;
        if (target instanceof Node && root.contains(target)) return;
        onMaskClose?.();
        dialog.close();
    };
    mask.addEventListener("click", handler);
    const cleanupObserver = new MutationObserver(() => {
        if (!document.body.contains(root)) {
            mask.removeEventListener("click", handler);
            cleanupObserver.disconnect();
        }
    });
    cleanupObserver.observe(document.body, { childList: true, subtree: true });
};

const moveMaskIntoPlugin = (mask: HTMLElement | undefined) => {
    if (mask === undefined) return;
    const pluginRoot = document.getElementById("plugin--vibe-hacking");
    if (pluginRoot === null) return;
    if (pluginRoot.contains(mask)) return;
    pluginRoot.appendChild(mask);
};

const applyDialogChrome = (
    root: HTMLElement,
    mask: HTMLElement | undefined,
    closeOnMask: boolean,
    dialog: DialogHandle | undefined,
    onMaskClose?: () => void,
) => {
    applyRootChrome(root);
    applyMaskChrome(mask);
    const rootNode = root.getRootNode();
    ensureDialogStyles(rootNode instanceof ShadowRoot ? rootNode : root.ownerDocument);
    moveMaskIntoPlugin(mask);
    attachDetailsFallback(root);
    if (closeOnMask) attachMaskClose(root, mask, dialog, onMaskClose);
};

const setupDialogChrome = (
    closeOnMask: boolean,
    dialog: DialogHandle | undefined,
    onMaskClose?: () => void,
) => {
    const attach = () => {
        const content = document.querySelector(DIALOG_CONTENT_SELECTOR);
        if (!(content instanceof HTMLElement)) return false;
        const root = content.closest(DIALOG_ROOT_SELECTOR);
        if (!(root instanceof HTMLElement)) return false;
        const mask = root.closest('[data-pc-section="mask"]');
        applyDialogChrome(
            root,
            mask instanceof HTMLElement ? mask : undefined,
            closeOnMask,
            dialog,
            onMaskClose,
        );
        return true;
    };

    if (attach()) return;
    const observer = new MutationObserver(() => {
        if (attach()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
};

export const showQDialog = (sdk: FrontendSDK, options: QDialogOptions = {}) => {
    ensureDialogStyles();
    const dialogOptions: Record<string, unknown> = { ...DEFAULT_DIALOG_OPTIONS };
    if (typeof options.closeOnMask === "boolean") {
        dialogOptions.dismissableMask = options.closeOnMask;
        dialogOptions.closeOnMask = options.closeOnMask;
    }

    const dialog = sdk.window.showDialog(
        {
            component: QDialog,
            props: {
                title: options.title,
                message: options.message,
                kicker: options.kicker,
                details: options.details,
                detailsTitle: options.detailsTitle,
                okText: options.okText,
                cancelText: options.cancelText,
                showCancel: options.showCancel,
            },
            events: {
                ok: () => {
                    options.onOk?.();
                    dialog.close();
                },
                cancel: () => {
                    options.onCancel?.();
                    dialog.close();
                },
            },
        },
        dialogOptions,
    );

    setupDialogChrome(Boolean(options.closeOnMask), dialog, options.onCancel);
    return dialog;
};

void showQDialog;
