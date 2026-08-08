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

const normalizeFilterClause = (clause: unknown): unknown => {
    if (typeof clause === "string") return clause;
    if (clause !== null && typeof clause === "object") {
        const code = (clause as { code?: unknown }).code;
        if (typeof code === "string") return code;
    }
    return clause;
};

const normalizeFilterPreset = (preset: unknown): unknown => {
    if (preset === null || typeof preset !== "object") return preset;
    return {
        ...(preset as Record<string, unknown>),
        clause: normalizeFilterClause((preset as { clause?: unknown }).clause),
    };
};

const toGraphqlFilterInput = (input: {
    name: string;
    alias: string;
    clause: string;
    global: boolean;
}) => ({
    name: input.name,
    alias: input.alias,
    clause: { HTTPQL: { code: input.clause } },
    global: input.global,
});

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
            global: z.boolean().default(false),
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
        toolName: "list_filter_presets",
        description: "List saved HTTPQL filters.",
        inputSchema: listFilterPresetsSchema,
        handler: async () => {
            const response = await sdk.graphql.execute(LIST_FILTER_PRESETS_QUERY);
            const data = response.data as { filterPresets?: unknown[] } | undefined;
            if (data?.filterPresets !== undefined) {
                return {
                    content: [
                        {
                            type: "text",
                            text: stringifyResult({
                                filterPresets: data.filterPresets.map(normalizeFilterPreset),
                            }),
                        },
                    ],
                };
            }
            return {
                content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.filters.get",
        group: ToolGroupId.FilterSafe,
        toolName: "get_filter_preset",
        description: "Get saved filters by ID.",
        inputSchema: getFilterPresetSchema,
        handler: async (params) => {
            const { ids } = getFilterPresetSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute(GET_FILTER_PRESET_QUERY, { id });
                    const data = response.data as { filterPreset?: unknown } | undefined;
                    if (data?.filterPreset !== undefined) {
                        return {
                            id,
                            result: { filterPreset: normalizeFilterPreset(data.filterPreset) },
                        };
                    }
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
        toolName: "create_filter_preset",
        description:
            "Create saved HTTPQL filters. global defaults to false (project-local); set true for a global preset. " +
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
                    }>(CREATE_FILTER_PRESET_MUTATION, { input: toGraphqlFilterInput(item) });
                    const data = response.data;
                    const error = data?.createFilterPreset?.error ?? response.errors;
                    if (error !== undefined && error !== null) {
                        return { input: item, error };
                    }
                    return {
                        input: item,
                        result:
                            normalizeFilterPreset(data?.createFilterPreset?.filter) ??
                            response.data ??
                            response,
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
        toolName: "update_filter_preset",
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
            }>(UPDATE_FILTER_PRESET_MUTATION, { id, input: toGraphqlFilterInput(input) });
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
                            normalizeFilterPreset(data?.updateFilterPreset?.filter) ??
                                response.data ??
                                response,
                        ),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.filters.delete",
        group: ToolGroupId.FilterUnsafe,
        toolName: "delete_filter_preset",
        description: "Delete saved filters by ID.",
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
