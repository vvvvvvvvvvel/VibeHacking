import { z } from "zod";

import {
    CREATE_ENVIRONMENT_MUTATION,
    DELETE_ENVIRONMENT_MUTATION,
    GET_ENVIRONMENT_CONTEXT_QUERY,
    GET_ENVIRONMENT_QUERY,
    LIST_ENVIRONMENTS_QUERY,
    SELECT_ENVIRONMENT_MUTATION,
    UPDATE_ENVIRONMENT_MUTATION,
} from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult } from "./shared";

export const registerEnvTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const idSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const envVarSchema = z.object({ name: z.string().min(1) }).strict();
    const envVarsSchema = z.object({}).strict();
    const envSetVarSchema = z
        .object({
            name: z.string().min(1),
            value: z.string(),
            secret: z.boolean().optional(),
            global: z.boolean().optional(),
            env: z.string().optional(),
        })
        .strict();
    const envVariableSchema = z
        .object({
            name: z.string().min(1),
            value: z.string(),
            kind: z.enum(["PLAIN", "SECRET"]).optional(),
        })
        .strict();
    const envVariablesSchema = z.array(envVariableSchema);
    const envCreateSchema = z
        .object({
            name: z.string().min(1),
            variables: envVariablesSchema.optional(),
        })
        .strict();
    const envUpdateSchema = z
        .object({
            id: idSchema,
            name: z.string().min(1).optional(),
            version: z.number().int().nonnegative().optional(),
            variables: envVariablesSchema,
        })
        .strict();
    const envSelectSchema = z
        .object({
            id: idSchema.nullable().optional(),
        })
        .strict();
    const envIdSchema = z.object({ id: idSchema }).strict();

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.getVar",
        group: ToolGroupId.EnvSafe,
        toolName: "get_environment_variable",
        description: "Get one variable from the environment context (selected + global).",
        inputSchema: envVarSchema,
        handler: (params) => {
            const { name } = params as { name: string };
            return {
                content: [{ type: "text", text: sdk.env.getVar(name) ?? "(environment not set)" }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.getVars",
        group: ToolGroupId.EnvSafe,
        toolName: "list_environment_variables",
        description: "List variables from the environment context (selected + global).",
        inputSchema: envVarsSchema,
        handler: () => {
            const vars = sdk.env.getVars().map((variable) => ({
                name: variable.name,
                value: variable.value,
                isSecret: variable.isSecret,
            }));
            return {
                content: [{ type: "text", text: stringifyResult(vars) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.setVar",
        group: ToolGroupId.EnvSafe,
        toolName: "set_environment_variable",
        description:
            "Set one variable in the global, selected, or named environment (overwrites existing; defaults to global). " +
            'Example: { "name": "FOO", "value": "bar", "secret": false, "global": false }.',
        inputSchema: envSetVarSchema,
        handler: async (params) => {
            const input = params as {
                name: string;
                value: string;
                secret?: boolean;
                global?: boolean;
                env?: string;
            };
            await sdk.env.setVar({
                name: input.name,
                value: input.value,
                secret: input.secret ?? false,
                global: input.global ?? true,
                env: input.env,
            });
            return { content: [{ type: "text", text: "ok" }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.list",
        group: ToolGroupId.EnvSafe,
        toolName: "list_environments",
        description: "List all environments with variables.",
        inputSchema: envVarsSchema,
        handler: async () => {
            const response = await sdk.graphql.execute(LIST_ENVIRONMENTS_QUERY);
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.getInfo",
        group: ToolGroupId.EnvSafe,
        toolName: "get_environment",
        description: "Get an environment record by ID.",
        inputSchema: envIdSchema,
        handler: async (params) => {
            const response = await sdk.graphql.execute(GET_ENVIRONMENT_QUERY, params);
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.getContext",
        group: ToolGroupId.EnvSafe,
        toolName: "get_environment_context",
        description: "Get environment context (selected + global).",
        inputSchema: envVarsSchema,
        handler: async () => {
            const response = await sdk.graphql.execute(GET_ENVIRONMENT_CONTEXT_QUERY);
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.create",
        group: ToolGroupId.EnvSafe,
        toolName: "create_environment",
        description:
            "Create an environment. " +
            'Example: { "name": "Staging", "variables": [{ "name": "API_URL", "value": "https://..." }] }.',
        inputSchema: envCreateSchema,
        handler: async (params) => {
            const input = params as {
                name: string;
                variables?: Array<{ name: string; value: string; kind?: "PLAIN" | "SECRET" }>;
            };
            const response = await sdk.graphql.execute(CREATE_ENVIRONMENT_MUTATION, {
                input: {
                    name: input.name,
                    variables:
                        input.variables?.map((variable) => ({
                            name: variable.name,
                            value: variable.value,
                            kind: variable.kind ?? "PLAIN",
                        })) ?? [],
                },
            });
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.update",
        group: ToolGroupId.EnvUnsafe,
        toolName: "update_environment",
        description:
            "Update an environment by ID. " +
            'Example: { "id": 1, "variables": [{ "name": "API_URL", "value": "https://..." }] }.',
        inputSchema: envUpdateSchema,
        handler: async (params) => {
            const input = params as {
                id: string;
                name?: string;
                version?: number;
                variables: Array<{ name: string; value: string; kind?: "PLAIN" | "SECRET" }>;
            };
            let name = input.name;
            let version = input.version;
            if (name === undefined || version === undefined) {
                const current = await sdk.graphql.execute<{
                    environment?: { name?: string; version?: number };
                }>(GET_ENVIRONMENT_QUERY, { id: input.id });
                const env = current.data?.environment;
                name = name ?? env?.name;
                version = version ?? env?.version;
            }
            if (name === undefined || version === undefined) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "error: environment not found or missing name/version",
                        },
                    ],
                };
            }
            const response = await sdk.graphql.execute(UPDATE_ENVIRONMENT_MUTATION, {
                id: input.id,
                input: {
                    name,
                    version,
                    variables: input.variables.map((variable) => ({
                        name: variable.name,
                        value: variable.value,
                        kind: variable.kind ?? "PLAIN",
                    })),
                },
            });
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.delete",
        group: ToolGroupId.EnvUnsafe,
        toolName: "delete_environment",
        description: "Delete an environment by ID.",
        inputSchema: envIdSchema,
        handler: async (params) => {
            const response = await sdk.graphql.execute(DELETE_ENVIRONMENT_MUTATION, params);
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.env.select",
        group: ToolGroupId.EnvSafe,
        toolName: "select_environment",
        description: "Select the active environment; pass id=null to clear selection.",
        inputSchema: envSelectSchema,
        handler: async (params) => {
            const input = params as { id?: string };
            const response = await sdk.graphql.execute(SELECT_ENVIRONMENT_MUTATION, {
                id: input.id ?? null,
            });
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });
};
