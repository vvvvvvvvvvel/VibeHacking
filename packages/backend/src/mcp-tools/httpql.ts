import { z } from "zod";

import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { HTTPQL_HELP_PROMPT } from "./shared";

export const registerHttpqlTools = ({ server, sdk, store, permissions }: ToolContext) => {
    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.httpql.help",
        group: ToolGroupId.HelpSafe,
        toolName: "get-httpql-help",
        description: "Get a HTTPQL reference. Example: {}.",
        inputSchema: z.object({}).strict(),
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
            destructiveHint: false,
            openWorldHint: false,
        },
        handler: () => {
            return {
                content: [{ type: "text", text: HTTPQL_HELP_PROMPT }],
            };
        },
    });
};
