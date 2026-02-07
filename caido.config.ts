import path from "path";

import { defineConfig } from "@caido-community/dev";
import vue from "@vitejs/plugin-vue";
import autoprefixer from "autoprefixer";
import prefixwrap from "postcss-prefixwrap";

import { MCP_PLUGIN_VERSION } from "./packages/shared";

const id = "caido-mcp";
// noinspection JSUnusedGlobalSymbols
export default defineConfig({
    id: "caido-mcp",
    name: "Vibe Hacking",
    version: MCP_PLUGIN_VERSION,
    description: "Caido MCP plugin",
    author: {
        name: "vvvvvvvvvvel",
        email: undefined,
        url: "https://github.com/vvvvvvvvvvel",
    },
    plugins: [
        {
            kind: "backend",
            id: "backend",
            root: "packages/backend",
        },
        {
            kind: "frontend",
            id: "frontend",
            root: "packages/frontend",
            backend: {
                id: "backend",
            },
            vite: {
                plugins: [vue()],
                build: {
                    rollupOptions: {
                        external: ["@caido/frontend-sdk"],
                    },
                },
                resolve: {
                    alias: [
                        {
                            find: "@",
                            replacement: path.resolve(__dirname, "packages/frontend/src"),
                        },
                    ],
                },
                css: {
                    postcss: {
                        plugins: [
                            prefixwrap(`#plugin--${id}`, {
                                ignoredSelectors: [/^\\.mcp-dialog/],
                            }),
                            autoprefixer,
                        ],
                    },
                },
            },
        },
    ],
});
