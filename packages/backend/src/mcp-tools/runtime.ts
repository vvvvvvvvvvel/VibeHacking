import { z } from "zod";

import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";

export const registerRuntimeTools = ({
    server,
    sdk,
    store,
    permissions,
    toolsByAction,
}: ToolContext) => {
    const versionSchema = z.object({}).strict();

    toolsByAction.set(
        "sdk.runtime.version",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.runtime.version",
            group: ToolGroupId.RuntimeSafe,
            toolName: "version",
            description: "Get the current Caido version. Example: {}.",
            inputSchema: versionSchema,
            handler: () => {
                return {
                    content: [{ type: "text", text: sdk.runtime.version }],
                };
            },
        }),
    );
};
