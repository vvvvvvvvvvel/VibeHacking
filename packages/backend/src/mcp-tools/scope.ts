import { z } from "zod";

import {
    CREATE_SCOPE_MUTATION,
    DELETE_SCOPE_MUTATION,
    GET_SCOPE_QUERY,
    LIST_SCOPES_QUERY,
    RENAME_SCOPE_MUTATION,
    UPDATE_SCOPE_MUTATION,
} from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult } from "./shared";

export const registerScopeTools = ({
    server,
    sdk,
    store,
    permissions,
    toolsByAction,
}: ToolContext) => {
    const idSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const scopeGetAllSchema = z.object({}).strict();
    const scopeInputSchema = z
        .object({
            name: z.string().min(1),
            allowlist: z.array(z.string().min(1)),
            denylist: z.array(z.string().min(1)),
        })
        .strict();
    const scopeCreateSchema = z.object({ items: z.array(scopeInputSchema).min(1) }).strict();
    const scopeRenameSchema = z
        .object({
            items: z.array(z.object({ id: idSchema, name: z.string().min(1) }).strict()).min(1),
        })
        .strict();
    const scopeIdBatchSchema = z.object({ ids: z.array(idSchema).min(1) }).strict();
    const scopeUpdateSchema = z.object({ id: idSchema, input: scopeInputSchema }).strict();

    toolsByAction.set(
        "sdk.scope.list",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.scope.list",
            group: ToolGroupId.ScopeSafe,
            toolName: "list-scopes",
            description: "List scopes. Example: {}.",
            inputSchema: scopeGetAllSchema,
            handler: async () => {
                const response = await sdk.graphql.execute(LIST_SCOPES_QUERY);
                return {
                    content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
                };
            },
        }),
    );

    toolsByAction.set(
        "sdk.scope.get",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.scope.get",
            group: ToolGroupId.ScopeSafe,
            toolName: "get-scope",
            description: 'Get scopes by ID. Example: { "ids": [1] }.',
            inputSchema: scopeIdBatchSchema,
            handler: async (params) => {
                const { ids } = scopeIdBatchSchema.parse(params);
                const results = await Promise.all(
                    ids.map(async (id) => {
                        const response = await sdk.graphql.execute(GET_SCOPE_QUERY, { id });
                        return { id, result: response.data ?? response };
                    }),
                );
                return {
                    content: [{ type: "text", text: stringifyResult(results) }],
                };
            },
        }),
    );

    toolsByAction.set(
        "sdk.scope.create",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.scope.create",
            group: ToolGroupId.ScopeSafe,
            toolName: "create-scope",
            description:
                "Create scopes. " +
                'Example: { "items": [{ "name": "In scope", "allowlist": ["example.com"], "denylist": ["*.png"] }] }.',
            inputSchema: scopeCreateSchema,
            handler: async (params) => {
                const { items } = scopeCreateSchema.parse(params);
                const results = await Promise.all(
                    items.map(async (item) => {
                        const response = await sdk.graphql.execute(CREATE_SCOPE_MUTATION, {
                            input: item,
                        });
                        return { input: item, result: response.data ?? response };
                    }),
                );
                return {
                    content: [{ type: "text", text: stringifyResult(results) }],
                };
            },
        }),
    );

    toolsByAction.set(
        "sdk.scope.update",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.scope.update",
            group: ToolGroupId.ScopeUnsafe,
            toolName: "update-scope",
            description:
                "Update a scope. " +
                'Example: { "id": 1, "input": { "name": "In scope", "allowlist": ["example.com"], "denylist": [] } }.',
            inputSchema: scopeUpdateSchema,
            handler: async (params) => {
                const response = await sdk.graphql.execute(UPDATE_SCOPE_MUTATION, params);
                return {
                    content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
                };
            },
        }),
    );

    toolsByAction.set(
        "sdk.scope.rename",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.scope.rename",
            group: ToolGroupId.ScopeSafe,
            toolName: "rename-scope",
            description: 'Rename scopes. Example: { "items": [{ "id": 1, "name": "New name" }] }.',
            inputSchema: scopeRenameSchema,
            handler: async (params) => {
                const { items } = scopeRenameSchema.parse(params);
                const results = await Promise.all(
                    items.map(async (item) => {
                        const response = await sdk.graphql.execute(RENAME_SCOPE_MUTATION, item);
                        return { id: item.id, result: response.data ?? response };
                    }),
                );
                return {
                    content: [{ type: "text", text: stringifyResult(results) }],
                };
            },
        }),
    );

    toolsByAction.set(
        "sdk.scope.delete",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.scope.delete",
            group: ToolGroupId.ScopeUnsafe,
            toolName: "delete-scope",
            description: 'Delete scopes by ID. Example: { "ids": [1] }.',
            inputSchema: scopeIdBatchSchema,
            handler: async (params) => {
                const { ids } = scopeIdBatchSchema.parse(params);
                const results = await Promise.all(
                    ids.map(async (id) => {
                        const response = await sdk.graphql.execute(DELETE_SCOPE_MUTATION, { id });
                        return { id, result: response.data ?? response };
                    }),
                );
                return {
                    content: [{ type: "text", text: stringifyResult(results) }],
                };
            },
        }),
    );
};
