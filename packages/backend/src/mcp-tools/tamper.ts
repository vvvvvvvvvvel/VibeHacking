import { z } from "zod";

import {
    CREATE_TAMPER_RULE_COLLECTION_MUTATION,
    CREATE_TAMPER_RULE_MUTATION,
    DELETE_TAMPER_RULE_COLLECTION_MUTATION,
    DELETE_TAMPER_RULE_MUTATION,
    EXPORT_TAMPER_MUTATION,
    GET_TAMPER_RULE_COLLECTION_QUERY,
    GET_TAMPER_RULE_QUERY,
    LIST_TAMPER_RULE_COLLECTIONS_QUERY,
    MOVE_TAMPER_RULE_MUTATION,
    RANK_TAMPER_RULE_MUTATION,
    RENAME_TAMPER_RULE_COLLECTION_MUTATION,
    RENAME_TAMPER_RULE_MUTATION,
    TEST_TAMPER_RULE_MUTATION,
    TOGGLE_TAMPER_RULE_MUTATION,
    UPDATE_TAMPER_RULE_MUTATION,
} from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult, validateHttpqlClause } from "./shared";

const SOURCE_VALUES = [
    "AUTOMATE",
    "INTERCEPT",
    // "REPLAY", todo not worked
    // "WORKFLOW",
    // "SAMPLE",
    // "PLUGIN",
    // "IMPORT",
] as const;

const TARGETS = ["request", "response"] as const;
const PARTS = [
    "header",
    "query",
    "body",
    "path",
    "method",
    "first_line",
    "status_code",
    "all",
    "sni",
] as const;
const OPS = ["add", "update", "remove", "raw"] as const;

const extractGraphqlResult = (response: unknown) => {
    if (response !== null && typeof response === "object" && "data" in response) {
        const data = (response as { data?: unknown }).data;
        return data ?? response;
    }
    return response;
};

const normalizeQueryClause = (query: unknown): unknown => {
    if (typeof query === "string" || query === null || query === undefined) return query;
    if (typeof query === "object") {
        const code = (query as { code?: unknown }).code;
        if (typeof code === "string") return code;
    }
    return query;
};

const normalizeTamperRule = (rule: unknown): unknown => {
    if (rule === null || typeof rule !== "object") return rule;
    return {
        ...(rule as Record<string, unknown>),
        condition: normalizeQueryClause((rule as { condition?: unknown }).condition),
    };
};

const normalizeTamperCollection = (collection: unknown): unknown => {
    if (collection === null || typeof collection !== "object") return collection;
    const rules = (collection as { rules?: unknown }).rules;
    return {
        ...(collection as Record<string, unknown>),
        rules: Array.isArray(rules) ? rules.map(normalizeTamperRule) : rules,
    };
};

const normalizeTamperResult = (result: unknown): unknown => {
    if (result === null || typeof result !== "object") return result;
    const data = result as Record<string, unknown>;
    if (Array.isArray(data.tamperRuleCollections)) {
        return {
            ...data,
            tamperRuleCollections: data.tamperRuleCollections.map(normalizeTamperCollection),
        };
    }
    if (data.tamperRuleCollection !== undefined) {
        return {
            ...data,
            tamperRuleCollection: normalizeTamperCollection(data.tamperRuleCollection),
        };
    }
    if (data.tamperRule !== undefined) {
        return { ...data, tamperRule: normalizeTamperRule(data.tamperRule) };
    }
    for (const key of ["createTamperRule", "updateTamperRule"]) {
        const mutation = data[key];
        if (mutation !== null && typeof mutation === "object" && "rule" in mutation) {
            return {
                ...data,
                [key]: {
                    ...(mutation as Record<string, unknown>),
                    rule: normalizeTamperRule((mutation as { rule?: unknown }).rule),
                },
            };
        }
    }
    return result;
};

const toGraphqlConditionInput = (condition: string | undefined) =>
    condition === undefined ? undefined : { HTTPQL: { code: condition } };

const buildMatcherName = (name: string) => ({ name });
const buildMatcherRaw = (
    matcher:
        | { type: "full" }
        | { type: "name"; value: string }
        | { type: "value"; value: string }
        | { type: "regex"; value: string },
) => {
    if (matcher.type === "value") {
        return { value: { value: matcher.value } };
    }
    if (matcher.type === "regex") {
        return { regex: { regex: matcher.value } };
    }
    return { full: { full: true } };
};

const buildReplacer = (
    replacer: { type: "term"; value: string } | { type: "workflow"; value: string },
) => {
    if (replacer.type === "workflow") {
        return { workflow: { id: replacer.value } };
    }
    return { term: { term: replacer.value } };
};

const buildSimpleSection = (input: {
    target: (typeof TARGETS)[number];
    part: (typeof PARTS)[number];
    operation: (typeof OPS)[number];
    matcher:
        | { type: "full" }
        | { type: "name"; value: string }
        | { type: "value"; value: string }
        | { type: "regex"; value: string };
    replacer: { type: "term"; value: string } | { type: "workflow"; value: string };
}) => {
    const { target, part, operation, matcher, replacer } = input;
    const section: Record<string, unknown> = {};
    const prefix = target === "request" ? "request" : "response";

    if (part === "header" || part === "query") {
        const matcherName = matcher.type === "name" ? matcher.value : "";
        const op =
            operation === "remove"
                ? { remove: { matcher: buildMatcherName(matcherName) } }
                : operation === "add"
                  ? {
                        add: {
                            matcher: buildMatcherName(matcherName),
                            replacer: buildReplacer(replacer),
                        },
                    }
                  : {
                        update: {
                            matcher: buildMatcherName(matcherName),
                            replacer: buildReplacer(replacer),
                        },
                    };
        section[`${prefix}${part === "header" ? "Header" : "Query"}`] = { operation: op };
        return section;
    }

    if (part === "body" || part === "path" || part === "first_line" || part === "all") {
        const rawOp = {
            raw: {
                matcher: buildMatcherRaw(matcher),
                replacer: buildReplacer(replacer),
            },
        };
        const key =
            part === "body"
                ? `${prefix}Body`
                : part === "path"
                  ? `${prefix}Path`
                  : part === "first_line"
                    ? `${prefix}FirstLine`
                    : `${prefix}All`;
        section[key] = { operation: rawOp };
        return section;
    }

    if (part === "method") {
        section[`${prefix}Method`] = {
            operation: { update: { replacer: buildReplacer(replacer) } },
        };
        return section;
    }

    if (part === "status_code") {
        section["responseStatusCode"] = {
            operation: { update: { replacer: buildReplacer(replacer) } },
        };
        return section;
    }

    if (part === "sni") {
        section["requestSNI"] = { operation: { raw: { replacer: buildReplacer(replacer) } } };
        return section;
    }

    return section;
};

export const registerTamperTools = ({ server, sdk, store, permissions }: ToolContext) => {
    const idSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const sourcesSchema = z.array(z.enum(SOURCE_VALUES)).min(1);
    const simpleMatcherSchema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("full") }).strict(),
        z.object({ type: z.literal("name"), value: z.string().min(1) }).strict(),
        z.object({ type: z.literal("value"), value: z.string().min(1) }).strict(),
        z.object({ type: z.literal("regex"), value: z.string().min(1) }).strict(),
    ]);
    const simpleReplacerSchema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("term"), value: z.string().min(1) }).strict(),
        z.object({ type: z.literal("workflow"), value: z.string().min(1) }).strict(),
    ]);
    const simpleRuleBaseSchema = z
        .object({
            name: z.string().min(1),
            target: z.enum(TARGETS),
            part: z.enum(PARTS),
            operation: z.enum(OPS),
            matcher: simpleMatcherSchema,
            replacer: simpleReplacerSchema,
            condition: z.string().min(1).optional(),
            sources: sourcesSchema,
        })
        .strict()
        .superRefine((value, ctx) => {
            if (value.part === "header" || value.part === "query") {
                if (value.matcher?.type !== "name") {
                    ctx.addIssue({
                        code: "custom",
                        message: 'matcher.type must be "name" for header/query',
                        path: ["matcher", "type"],
                    });
                }
            }
            if (value.part === "status_code" && value.target === "request") {
                ctx.addIssue({
                    code: "custom",
                    message: "status_code is only valid for response",
                    path: ["part"],
                });
            }
            if (value.part === "sni" && value.target === "response") {
                ctx.addIssue({
                    code: "custom",
                    message: "sni is only valid for request",
                    path: ["part"],
                });
            }
        });
    const simpleRuleCreateSchema = simpleRuleBaseSchema.safeExtend({ collection_id: idSchema });
    const simpleRuleUpdateSchema = simpleRuleBaseSchema.safeExtend({ id: idSchema });
    const idArraySchema = z.array(idSchema).min(1);
    const renamePairSchema = z.object({ id: idSchema, name: z.string().min(1) }).strict();
    const createCollectionSchema = z.object({ items: z.array(z.string().min(1)).min(1) }).strict();
    const renameCollectionSchema = z.object({ items: z.array(renamePairSchema).min(1) }).strict();
    const deleteCollectionSchema = z.object({ ids: idArraySchema }).strict();
    const getCollectionSchema = z.object({ ids: idArraySchema }).strict();
    const getRuleSchema = z.object({ ids: idArraySchema }).strict();
    const createRuleSchema = z.object({ items: z.array(simpleRuleCreateSchema).min(1) }).strict();
    const updateRuleSchema = z.object({ items: z.array(simpleRuleUpdateSchema).min(1) }).strict();
    const renameRuleSchema = z.object({ items: z.array(renamePairSchema).min(1) }).strict();
    const deleteRuleSchema = z.object({ rule_ids: idArraySchema }).strict();
    const toggleRuleSchema = z.object({ rule_ids: idArraySchema, enabled: z.boolean() }).strict();
    const moveRuleSchema = z.object({ rule_ids: idArraySchema, collection_id: idSchema }).strict();
    const testTamperRuleSimpleSchema = z
        .object({
            raw_base64: z.string().min(1),
            target: z.enum(TARGETS),
            part: z.enum(PARTS),
            operation: z.enum(OPS),
            matcher: simpleMatcherSchema,
            replacer: simpleReplacerSchema,
        })
        .strict();
    const emptySchema = z.object({}).strict();

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.listCollections",
        group: ToolGroupId.TamperSafe,
        toolName: "list_tamper_rule_collections",
        description: "List Tamper rule collections with their rules.",
        inputSchema: emptySchema,
        handler: async () => {
            const response = await sdk.graphql.execute(LIST_TAMPER_RULE_COLLECTIONS_QUERY);
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult(
                            normalizeTamperResult(extractGraphqlResult(response)),
                        ),
                    },
                ],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.getCollection",
        group: ToolGroupId.TamperSafe,
        toolName: "get_tamper_rule_collection",
        description: "Get Tamper rule collections by ID.",
        inputSchema: getCollectionSchema,
        handler: async (params) => {
            const { ids } = getCollectionSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute(GET_TAMPER_RULE_COLLECTION_QUERY, {
                        id,
                    });
                    return { id, result: normalizeTamperResult(extractGraphqlResult(response)) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.getRule",
        group: ToolGroupId.TamperSafe,
        toolName: "get_tamper_rule",
        description: "Get Tamper rules by ID.",
        inputSchema: getRuleSchema,
        handler: async (params) => {
            const { ids } = getRuleSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute(GET_TAMPER_RULE_QUERY, { id });
                    return { id, result: normalizeTamperResult(extractGraphqlResult(response)) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.createCollection",
        group: ToolGroupId.TamperSafe,
        toolName: "create_tamper_rule_collection",
        description: "Create Tamper rule collections.",
        inputSchema: createCollectionSchema,
        handler: async (params) => {
            const { items } = createCollectionSchema.parse(params);
            const results = await Promise.all(
                items.map(async (name) => {
                    const response = await sdk.graphql.execute(
                        CREATE_TAMPER_RULE_COLLECTION_MUTATION,
                        { input: { name } },
                    );
                    return { name, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.renameCollection",
        group: ToolGroupId.TamperSafe,
        toolName: "rename_tamper_rule_collection",
        description: "Rename Tamper rule collections.",
        inputSchema: renameCollectionSchema,
        handler: async (params) => {
            const { items } = renameCollectionSchema.parse(params);
            const results = await Promise.all(
                items.map(async (item) => {
                    const response = await sdk.graphql.execute(
                        RENAME_TAMPER_RULE_COLLECTION_MUTATION,
                        item,
                    );
                    return { id: item.id, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.deleteCollection",
        group: ToolGroupId.TamperUnsafe,
        toolName: "delete_tamper_rule_collection",
        description: "Delete Tamper rule collections by ID.",
        inputSchema: deleteCollectionSchema,
        handler: async (params) => {
            const { ids } = deleteCollectionSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute(
                        DELETE_TAMPER_RULE_COLLECTION_MUTATION,
                        { id },
                    );
                    return { id, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.createRule",
        group: ToolGroupId.TamperSafe,
        toolName: "create_tamper_rule",
        description:
            "Create Tamper rules. " +
            'Example: { "items": [{ "collection_id": 1, "name": "add-header", "target": "request", "part": "header", "operation": "add", ' +
            '"matcher": { "type": "name", "value": "X-Test" }, "replacer": { "type": "term", "value": "1" }, "sources": ["INTERCEPT"] }] }.',
        inputSchema: createRuleSchema,
        handler: async (params) => {
            const { items } = createRuleSchema.parse(params);
            const results = await Promise.all(
                items.map(async (item) => {
                    if (item.condition !== undefined) {
                        const validationError = await validateHttpqlClause(sdk, item.condition);
                        if (validationError !== null) {
                            return { name: item.name, error: validationError };
                        }
                    }
                    const section = buildSimpleSection(item);
                    const input = {
                        collectionId: item.collection_id,
                        name: item.name,
                        section,
                        condition: toGraphqlConditionInput(item.condition),
                        sources: item.sources,
                    };
                    const response = await sdk.graphql.execute(CREATE_TAMPER_RULE_MUTATION, {
                        input,
                    });
                    return {
                        name: item.name,
                        result: normalizeTamperResult(extractGraphqlResult(response)),
                    };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.updateRule",
        group: ToolGroupId.TamperUnsafe,
        toolName: "update_tamper_rule",
        description:
            'Update Tamper rules. Example: { "items": [{ "id": 1, "name": "updated", "target": "request", "part": "header", "operation": "update", "matcher": { "type": "name", "value": "X-Test" }, "replacer": { "type": "term", "value": "2" }, "sources": ["INTERCEPT"] }] }.',
        inputSchema: updateRuleSchema,
        handler: async (params) => {
            const { items } = updateRuleSchema.parse(params);
            const results = await Promise.all(
                items.map(async (item) => {
                    if (item.condition !== undefined) {
                        const validationError = await validateHttpqlClause(sdk, item.condition);
                        if (validationError !== null) {
                            return { id: item.id, error: validationError };
                        }
                    }
                    const section = buildSimpleSection(item);
                    const input = {
                        name: item.name,
                        section,
                        condition: toGraphqlConditionInput(item.condition),
                        sources: item.sources,
                    };
                    const response = await sdk.graphql.execute(UPDATE_TAMPER_RULE_MUTATION, {
                        id: item.id,
                        input,
                    });
                    return {
                        id: item.id,
                        result: normalizeTamperResult(extractGraphqlResult(response)),
                    };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.renameRule",
        group: ToolGroupId.TamperSafe,
        toolName: "rename_tamper_rule",
        description: "Rename Tamper rules.",
        inputSchema: renameRuleSchema,
        handler: async (params) => {
            const { items } = renameRuleSchema.parse(params);
            const results = await Promise.all(
                items.map(async (item) => {
                    const response = await sdk.graphql.execute(RENAME_TAMPER_RULE_MUTATION, item);
                    return { id: item.id, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.deleteRule",
        group: ToolGroupId.TamperUnsafe,
        toolName: "delete_tamper_rule",
        description: "Delete Tamper rules by ID.",
        inputSchema: deleteRuleSchema,
        handler: async (params) => {
            const { rule_ids } = deleteRuleSchema.parse(params);
            const results = await Promise.all(
                rule_ids.map(async (id) => {
                    const response = await sdk.graphql.execute(DELETE_TAMPER_RULE_MUTATION, { id });
                    return { id, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.toggleRule",
        group: ToolGroupId.TamperSafe,
        toolName: "toggle_tamper_rule",
        description: "Enable or disable Tamper rules.",
        inputSchema: toggleRuleSchema,
        handler: async (params) => {
            const { rule_ids, enabled } = toggleRuleSchema.parse(params);
            const results = await Promise.all(
                rule_ids.map(async (id) => {
                    const response = await sdk.graphql.execute(TOGGLE_TAMPER_RULE_MUTATION, {
                        id,
                        enabled,
                    });
                    return { id, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.moveRule",
        group: ToolGroupId.TamperSafe,
        toolName: "move_tamper_rule",
        description: "Move Tamper rules to another collection.",
        inputSchema: moveRuleSchema,
        handler: async (params) => {
            const { rule_ids, collection_id } = moveRuleSchema.parse(params);
            const results = await Promise.all(
                rule_ids.map(async (id) => {
                    const response = await sdk.graphql.execute(MOVE_TAMPER_RULE_MUTATION, {
                        id,
                        collectionId: collection_id,
                    });
                    return { id, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.rankRule",
        group: ToolGroupId.TamperSafe,
        toolName: "rank_tamper_rule",
        description: "Reorder a Tamper rule with before_id or after_id.",
        inputSchema: z
            .object({
                id: idSchema,
                input: z
                    .object({
                        before_id: idSchema.optional(),
                        after_id: idSchema.optional(),
                    })
                    .strict()
                    .refine((value) => Boolean(value.before_id) !== Boolean(value.after_id), {
                        message: "Provide before_id or after_id",
                    }),
            })
            .strict(),
        handler: async (params) => {
            const parsed = params as {
                id: string;
                input: { before_id?: string; after_id?: string };
            };
            const response = await sdk.graphql.execute(RANK_TAMPER_RULE_MUTATION, {
                id: parsed.id,
                input: {
                    beforeId: parsed.input.before_id,
                    afterId: parsed.input.after_id,
                },
            });
            return {
                content: [{ type: "text", text: stringifyResult(extractGraphqlResult(response)) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.test",
        group: ToolGroupId.TamperSafe,
        toolName: "test_tamper_rule",
        description:
            "Test a Tamper rule against raw HTTP. " +
            'Example: { "raw_base64": "...", "target": "request", "part": "header", "operation": "add", ' +
            '"matcher": { "type": "name", "value": "X-Test" }, "replacer": { "type": "term", "value": "1" } }.',
        inputSchema: testTamperRuleSimpleSchema,
        handler: async (params) => {
            const parsed = testTamperRuleSimpleSchema.parse(params);
            const section = buildSimpleSection(parsed);
            const response = await sdk.graphql.execute(TEST_TAMPER_RULE_MUTATION, {
                input: { raw: parsed.raw_base64, section },
            });
            return {
                content: [{ type: "text", text: stringifyResult(extractGraphqlResult(response)) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.export",
        group: ToolGroupId.TamperSafe,
        toolName: "export_tamper",
        description: "Export Tamper configuration. Provide collections or rules (IDs).",
        inputSchema: z
            .object({
                collections: z.array(idSchema).min(1).optional(),
                rules: z.array(idSchema).min(1).optional(),
            })
            .strict()
            .refine((value) => !(value.collections && value.rules), {
                message: "Provide collections or rules, not both",
            }),
        handler: async (params) => {
            const collectionsInput = Array.isArray(params.collections)
                ? params.collections
                : undefined;
            const rulesInput = Array.isArray(params.rules) ? params.rules : undefined;
            const hasTarget = collectionsInput !== undefined || rulesInput !== undefined;
            let target: { collections?: unknown[]; rules?: unknown[] } | undefined = hasTarget
                ? { collections: collectionsInput, rules: rulesInput }
                : undefined;
            if (target === undefined) {
                const collectionsResponse = await sdk.graphql.execute(
                    LIST_TAMPER_RULE_COLLECTIONS_QUERY,
                );
                const collections = normalizeTamperResult(
                    extractGraphqlResult(collectionsResponse),
                ) as { tamperRuleCollections?: Array<{ id?: unknown }> };
                target = {
                    collections: (collections.tamperRuleCollections ?? [])
                        .map((collection) => collection.id)
                        .filter((id) => id !== undefined && id !== null),
                };
            }
            const response = await sdk.graphql.execute(EXPORT_TAMPER_MUTATION, {
                input: { target },
            });
            return {
                content: [{ type: "text", text: stringifyResult(extractGraphqlResult(response)) }],
            };
        },
    });
};
