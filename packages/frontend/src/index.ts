import { createApp } from "vue";

import "./styles/index.css";
import App from "./views/App.vue";

import { registerConfirmDialog } from "@/services/confirm-dialog";
import type { FrontendSDK } from "@/types";

// noinspection JSUnusedGlobalSymbols
export const init = (sdk: FrontendSDK) => {
    const root = document.createElement("div");
    root.id = "plugin--vibe-hacking";

    const app = createApp(App, { sdk });
    app.mount(root);
    sdk.navigation.addPage("/vibe-hacking", { body: root });
    sdk.sidebar.registerItem("Vibe Hacking", "/vibe-hacking", {
        icon: "fas fa-plug",
        group: "Plugins",
    });
    registerConfirmDialog(sdk);
};
