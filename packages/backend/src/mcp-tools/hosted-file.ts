import { Buffer } from "buffer";

import { z } from "zod";

import { DELETE_HOSTED_FILE_MUTATION } from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult, toNumericId } from "./shared";

export const registerHostedFileTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const hostedFileGetAllSchema = z.object({}).strict();
    const hostedFileCreateSchema = z
        .object({
            name: z.string().min(1),
            content: z.string(),
            encoding: z.enum(["text", "base64"]).optional(),
        })
        .strict();
    const hostedFileDeleteSchema = z
        .object({
            id: z.preprocess(
                (value) => (typeof value === "number" ? String(value) : value),
                z.string().min(1),
            ),
        })
        .strict();

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.hostedFile.getAll",
        group: ToolGroupId.HostedFileSafe,
        toolName: "get_hosted_file",
        description: "List files from the Files section.",
        inputSchema: hostedFileGetAllSchema,
        handler: async () => {
            const files = await sdk.hostedFile.getAll();
            const results = files.map((file) => ({
                id: toNumericId(String(file.id)),
                name: file.name,
                path: file.path,
            }));
            return { content: [{ type: "text", text: stringifyResult(results) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.hostedFile.create",
        group: ToolGroupId.HostedFileSafe,
        toolName: "create_hosted_file",
        description:
            "Create a file in the Files section. " +
            'Example: { "name": "notes.txt", "content": "hello", "encoding": "text" }.',
        inputSchema: hostedFileCreateSchema,
        handler: async (params) => {
            const { name, content, encoding } = params as {
                name: string;
                content: string;
                encoding?: "text" | "base64";
            };
            const bytes =
                encoding === "base64" ? new Uint8Array(Buffer.from(content, "base64")) : content;
            const file = await sdk.hostedFile.create({ name, content: bytes });
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            id: toNumericId(String(file.id)),
                            name: file.name,
                            path: file.path,
                        }),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.hostedFile.delete",
        group: ToolGroupId.HostedFileUnsafe,
        toolName: "delete_hosted_file",
        description: "Delete a file from the Files section by ID.",
        inputSchema: hostedFileDeleteSchema,
        handler: async (params) => {
            const response = await sdk.graphql.execute<unknown>(
                DELETE_HOSTED_FILE_MUTATION,
                params,
            );
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });
};
