import { z } from "zod";

import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";

export const registerConsoleTools = ({
    server,
    sdk,
    store,
    permissions,
    toolsByAction,
}: ToolContext) => {
    const logSchema = z
        .object({
            level: z.enum(["debug", "info", "warn", "error"]),
            message: z.string(),
        })
        .strict();

    toolsByAction.set(
        "sdk.console.log",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.console.log",
            group: ToolGroupId.LogSafe,
            toolName: "log",
            description:
                "Write a log entry to the Caido backend console. " +
                'Example: { "level": "info", "message": "hello" }.',
            inputSchema: logSchema,
            handler: (params) => {
                const { level, message } = params as { level: string; message: string };
                const text = message;
                switch (level) {
                    case "debug":
                        sdk.console.debug(text);
                        break;
                    case "info":
                        sdk.console.log(text);
                        break;
                    case "warn":
                        sdk.console.warn(text);
                        break;
                    case "error":
                        sdk.console.error(text);
                        break;
                }
                return { content: [{ type: "text", text: "ok" }] };
            },
        }),
    );
};
