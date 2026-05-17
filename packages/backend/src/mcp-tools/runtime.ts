import { z } from "zod";

import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";

export const registerRuntimeTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const versionSchema = z.object({}).strict();

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.runtime.version",
        group: ToolGroupId.RuntimeSafe,
        toolName: "version",
        description: "Get the current Caido version.",
        inputSchema: versionSchema,
        handler: () => {
            return {
                content: [{ type: "text", text: sdk.runtime.version }],
            };
        },
    });
};
