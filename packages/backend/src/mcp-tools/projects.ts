import { z } from "zod";

import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult, toNumericId } from "./shared";

export const registerProjectTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const projectInfoSchema = z
        .object({
            field: z.enum(["id", "name", "path", "version", "status", "full"]).default("full"),
        })
        .strict();

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.projects.getInfo",
        group: ToolGroupId.ProjectSafe,
        toolName: "get_project_info",
        description:
            "Get a field from the current project. " +
            'If field is omitted, it defaults to "full". ' +
            'Use field="full" to return all fields. ' +
            "If no project is selected, returns (no project selected).",
        inputSchema: projectInfoSchema,
        handler: async (params) => {
            const { field } = projectInfoSchema.parse(params);
            const project = await sdk.projects.getCurrent();
            if (project === undefined) {
                return {
                    content: [{ type: "text", text: "(no project selected)" }],
                };
            }
            const info = {
                id: toNumericId(String(project.getId())),
                name: project.getName(),
                path: project.getPath(),
                version: project.getVersion(),
                status: project.getStatus(),
            };
            if (field === "full") {
                return {
                    content: [{ type: "text", text: stringifyResult(info) }],
                };
            }
            const value = info[field];
            return { content: [{ type: "text", text: String(value) }] };
        },
    });
};
