import { showQDialog } from "@/services/dialog";
import type { FrontendSDK } from "@/types";

let stopConfirmEvent: (() => void) | undefined;

export const registerConfirmDialog = (sdk: FrontendSDK) => {
    if (stopConfirmEvent !== undefined) return;
    const subscription = sdk.backend.onEvent("caido-mcp:confirm-action", (action, details, id) => {
        showQDialog(sdk, {
            title: "Confirm action",
            kicker: "MCP",
            message: action,
            detailsTitle: "Details",
            details,
            okText: "OK",
            cancelText: "Cancel",
            showCancel: true,
            closeOnMask: false,
            onOk: () => {
                void sdk.backend.confirmAction(Number(id), true).catch((err) => {
                    sdk.window.showToast(`Failed to confirm action.\n${err}`, {
                        variant: "error",
                    });
                });
            },
            onCancel: () => {
                void sdk.backend.confirmAction(Number(id), false).catch((err) => {
                    sdk.window.showToast(`Failed to cancel action.\n${err}`, {
                        variant: "error",
                    });
                });
            },
        });
    });
    stopConfirmEvent = subscription.stop;
};
