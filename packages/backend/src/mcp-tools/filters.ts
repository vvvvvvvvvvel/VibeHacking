import { z } from "zod";

import {
    CREATE_FILTER_PRESET_MUTATION,
    DELETE_FILTER_PRESET_MUTATION,
    GET_FILTER_PRESET_QUERY,
    LIST_FILTER_PRESETS_QUERY,
    UPDATE_FILTER_PRESET_MUTATION,
} from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { HTTPQL_HELP_SHORT, stringifyResult, validateHttpqlClause } from "./shared";

export const registerFilterTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const idSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const filterPresetSchema = z
        .object({
            name: z.string().min(1),
            alias: z.string().min(1),
            clause: z.string().min(1),
        })
        .strict();
    const listFilterPresetsSchema = z.object({}).strict();
    const getFilterPresetSchema = z.object({ ids: z.array(idSchema).min(1) }).strict();
    const createFilterPresetSchema = z
        .object({ items: z.array(filterPresetSchema).min(1) })
        .strict();
    const updateFilterPresetSchema = z.object({ id: idSchema, input: filterPresetSchema }).strict();
    const deleteFilterPresetSchema = z.object({ ids: z.array(idSchema).min(1) }).strict();

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.filters.list",
        group: ToolGroupId.FilterSafe,
        toolName: "list-filter-presets",
        description: "List saved HTTPQL filters. Example: {}.",
        inputSchema: listFilterPresetsSchema,
        handler: async () => {
            const response = await sdk.graphql.execute(LIST_FILTER_PRESETS_QUERY);
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.filters.get",
        group: ToolGroupId.FilterSafe,
        toolName: "get-filter-preset",
        description: 'Get saved filters by ID. Example: { "ids": [1] }.',
        inputSchema: getFilterPresetSchema,
        handler: async (params) => {
            const { ids } = getFilterPresetSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute(GET_FILTER_PRESET_QUERY, { id });
                    return { id, result: response.data ?? response };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.filters.create",
        group: ToolGroupId.FilterSafe,
        toolName: "create-filter-preset",
        description:
            "Create saved HTTPQL filters. " +
            'Example: { "items": [{ "name": "Posts", "alias": "posts", "clause": "req.method.eq:\\"POST\\"" }] }.' +
            "\n\n" +
            HTTPQL_HELP_SHORT,
        inputSchema: createFilterPresetSchema,
        handler: async (params) => {
            const { items } = createFilterPresetSchema.parse(params);
            const results = await Promise.all(
                items.map(async (item) => {
                    const validationError = await validateHttpqlClause(sdk, item.clause);
                    if (validationError !== null) {
                        return { input: item, error: validationError };
                    }
                    const response = await sdk.graphql.execute<{
                        createFilterPreset?: { filter?: unknown; error?: unknown };
                    }>(CREATE_FILTER_PRESET_MUTATION, { input: item });
                    const data = response.data;
                    const error = data?.createFilterPreset?.error ?? response.errors;
                    if (error !== undefined && error !== null) {
                        return { input: item, error };
                    }
                    return {
                        input: item,
                        result: data?.createFilterPreset?.filter ?? response.data ?? response,
                    };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.filters.update",
        group: ToolGroupId.FilterUnsafe,
        toolName: "update-filter-preset",
        description:
            "Update a saved HTTPQL filter. " +
            'Example: { "id": 1, "input": { "name": "Posts", "alias": "posts", "clause": "req.method.eq:\\"POST\\"" } }.' +
            "\n\n" +
            HTTPQL_HELP_SHORT,
        inputSchema: updateFilterPresetSchema,
        handler: async (params) => {
            const { id, input } = updateFilterPresetSchema.parse(params);
            const validationError = await validateHttpqlClause(sdk, input.clause);
            if (validationError !== null) {
                return {
                    content: [
                        {
                            type: "text",
                            text: stringifyResult({ id, input, error: validationError }),
                        },
                    ],
                };
            }
            const response = await sdk.graphql.execute<{
                updateFilterPreset?: { filter?: unknown; error?: unknown };
            }>(UPDATE_FILTER_PRESET_MUTATION, { id, input });
            const data = response.data;
            const error = data?.updateFilterPreset?.error ?? response.errors;
            if (error !== undefined && error !== null) {
                return {
                    content: [{ type: "text", text: stringifyResult({ id, input, error }) }],
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult(
                            data?.updateFilterPreset?.filter ?? response.data ?? response,
                        ),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.filters.delete",
        group: ToolGroupId.FilterUnsafe,
        toolName: "delete-filter-preset",
        description: 'Delete saved filters by ID. Example: { "ids": [1] }.',
        inputSchema: deleteFilterPresetSchema,
        handler: async (params) => {
            const { ids } = deleteFilterPresetSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute(DELETE_FILTER_PRESET_MUTATION, {
                        id,
                    });
                    return { id, result: response.data ?? response };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });
};
