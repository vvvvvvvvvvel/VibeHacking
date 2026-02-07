import { defaultConfig } from "@caido/eslint-config";

export default [
    ...defaultConfig({
        compat: false,
    }),
    {
        ignores: ["scripts/**/*.mjs", "scripts/mcp-smoke/**"],
    },
];
