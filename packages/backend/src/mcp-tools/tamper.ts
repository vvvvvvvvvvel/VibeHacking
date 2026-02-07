import { z } from "zod";

import {
    CREATE_TAMPER_RULE_COLLECTION_MUTATION,
    CREATE_TAMPER_RULE_MUTATION,
    DELETE_TAMPER_RULE_COLLECTION_MUTATION,
    DELETE_TAMPER_RULE_MUTATION,
    EXPORT_TAMPER_MUTATION,
    EXPORT_TAMPER_WITH_TARGET_MUTATION,
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
    "firstLine",
    "statusCode",
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

    if (part === "body" || part === "path" || part === "firstLine" || part === "all") {
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
                  : part === "firstLine"
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

    if (part === "statusCode") {
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
            if (value.part === "statusCode" && value.target === "request") {
                ctx.addIssue({
                    code: "custom",
                    message: "statusCode is only valid for response",
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
    const simpleRuleCreateSchema = simpleRuleBaseSchema.safeExtend({ collectionId: idSchema });
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
    const deleteRuleSchema = z.object({ ruleIds: idArraySchema }).strict();
    const toggleRuleSchema = z.object({ ruleIds: idArraySchema, enabled: z.boolean() }).strict();
    const moveRuleSchema = z.object({ ruleIds: idArraySchema, collectionId: idSchema }).strict();
    const testTamperRuleSimpleSchema = z
        .object({
            rawBase64: z.string().min(1),
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
        group: ToolGroupId.TemperSafe,
        toolName: "list-tamper-rule-collections",
        description: "List Tamper rule collections with their rules. Example: {}.",
        inputSchema: emptySchema,
        handler: async () => {
            const response = await sdk.graphql.execute(LIST_TAMPER_RULE_COLLECTIONS_QUERY);
            return {
                content: [{ type: "text", text: stringifyResult(extractGraphqlResult(response)) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.getCollection",
        group: ToolGroupId.TemperSafe,
        toolName: "get-tamper-rule-collection",
        description: 'Get Tamper rule collections by ID. Example: { "ids": [1] }.',
        inputSchema: getCollectionSchema,
        handler: async (params) => {
            const { ids } = getCollectionSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute(GET_TAMPER_RULE_COLLECTION_QUERY, {
                        id,
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
        action: "sdk.tamper.listRules",
        group: ToolGroupId.TemperSafe,
        toolName: "list-tamper-rules",
        description:
            "List Tamper rule collections with their rules (same as list-tamper-rule-collections). " +
            "Example: {}.",
        inputSchema: emptySchema,
        handler: async () => {
            const response = await sdk.graphql.execute(LIST_TAMPER_RULE_COLLECTIONS_QUERY);
            return {
                content: [{ type: "text", text: stringifyResult(extractGraphqlResult(response)) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.getRule",
        group: ToolGroupId.TemperSafe,
        toolName: "get-tamper-rule",
        description: 'Get Tamper rules by ID. Example: { "ids": [1] }.',
        inputSchema: getRuleSchema,
        handler: async (params) => {
            const { ids } = getRuleSchema.parse(params);
            const results = await Promise.all(
                ids.map(async (id) => {
                    const response = await sdk.graphql.execute(GET_TAMPER_RULE_QUERY, { id });
                    return { id, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.createCollection",
        group: ToolGroupId.TemperSafe,
        toolName: "create-tamper-rule-collection",
        description: 'Create Tamper rule collections. Example: { "items": ["My Rules"] }.',
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
        group: ToolGroupId.TemperSafe,
        toolName: "rename-tamper-rule-collection",
        description:
            'Rename Tamper rule collections. Example: { "items": [{ "id": 1, "name": "Renamed" }] }.',
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
        group: ToolGroupId.TemperUnsafe,
        toolName: "delete-tamper-rule-collection",
        description: 'Delete Tamper rule collections by ID. Example: { "ids": [1] }.',
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
        group: ToolGroupId.TemperSafe,
        toolName: "create-tamper-rule",
        description:
            "Create Tamper rules. " +
            'Example: { "items": [{ "collectionId": 1, "name": "add-header", "target": "request", "part": "header", "operation": "add", ' +
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
                        collectionId: item.collectionId,
                        name: item.name,
                        section,
                        condition: item.condition,
                        sources: item.sources,
                    };
                    const response = await sdk.graphql.execute(CREATE_TAMPER_RULE_MUTATION, {
                        input,
                    });
                    return { name: item.name, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.updateRule",
        group: ToolGroupId.TemperUnsafe,
        toolName: "update-tamper-rule",
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
                        condition: item.condition,
                        sources: item.sources,
                    };
                    const response = await sdk.graphql.execute(UPDATE_TAMPER_RULE_MUTATION, {
                        id: item.id,
                        input,
                    });
                    return { id: item.id, result: extractGraphqlResult(response) };
                }),
            );
            return {
                content: [{ type: "text", text: stringifyResult(results) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.renameRule",
        group: ToolGroupId.TemperSafe,
        toolName: "rename-tamper-rule",
        description: 'Rename Tamper rules. Example: { "items": [{ "id": 1, "name": "Renamed" }] }.',
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
        group: ToolGroupId.TemperUnsafe,
        toolName: "delete-tamper-rule",
        description: 'Delete Tamper rules by ID. Example: { "ruleIds": [1] }.',
        inputSchema: deleteRuleSchema,
        handler: async (params) => {
            const { ruleIds } = deleteRuleSchema.parse(params);
            const results = await Promise.all(
                ruleIds.map(async (id) => {
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
        group: ToolGroupId.TemperSafe,
        toolName: "toggle-tamper-rule",
        description:
            'Enable or disable Tamper rules. Example: { "ruleIds": [1], "enabled": true }.',
        inputSchema: toggleRuleSchema,
        handler: async (params) => {
            const { ruleIds, enabled } = toggleRuleSchema.parse(params);
            const results = await Promise.all(
                ruleIds.map(async (id) => {
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
        group: ToolGroupId.TemperSafe,
        toolName: "move-tamper-rule",
        description:
            'Move Tamper rules to another collection. Example: { "ruleIds": [1], "collectionId": 2 }.',
        inputSchema: moveRuleSchema,
        handler: async (params) => {
            const { ruleIds, collectionId } = moveRuleSchema.parse(params);
            const results = await Promise.all(
                ruleIds.map(async (id) => {
                    const response = await sdk.graphql.execute(MOVE_TAMPER_RULE_MUTATION, {
                        id,
                        collectionId,
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
        group: ToolGroupId.TemperSafe,
        toolName: "rank-tamper-rule",
        description: 'Reorder a Tamper rule. Example: { "id": 2, "input": { "afterId": 1 } }.',
        inputSchema: z
            .object({
                id: idSchema,
                input: z
                    .object({
                        beforeId: idSchema.optional(),
                        afterId: idSchema.optional(),
                    })
                    .strict()
                    .refine((value) => Boolean(value.beforeId) !== Boolean(value.afterId), {
                        message: "Provide beforeId or afterId",
                    }),
            })
            .strict(),
        handler: async (params) => {
            const response = await sdk.graphql.execute(RANK_TAMPER_RULE_MUTATION, params);
            return {
                content: [{ type: "text", text: stringifyResult(extractGraphqlResult(response)) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.test",
        group: ToolGroupId.TemperSafe,
        toolName: "test-tamper-rule",
        description:
            "Test a Tamper rule against raw HTTP. " +
            'Example: { "rawBase64": "...", "target": "request", "part": "header", "operation": "add", ' +
            '"matcher": { "type": "name", "value": "X-Test" }, "replacer": { "type": "term", "value": "1" } }.',
        inputSchema: testTamperRuleSimpleSchema,
        handler: async (params) => {
            const parsed = testTamperRuleSimpleSchema.parse(params);
            const section = buildSimpleSection(parsed);
            const response = await sdk.graphql.execute(TEST_TAMPER_RULE_MUTATION, {
                input: { raw: parsed.rawBase64, section },
            });
            return {
                content: [{ type: "text", text: stringifyResult(extractGraphqlResult(response)) }],
            };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.tamper.export",
        group: ToolGroupId.TemperSafe,
        toolName: "export-tamper",
        description:
            "Export Tamper configuration. Provide collections or rules (IDs). " +
            'Example: { "collections": [1] }.',
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
            const hasTarget = params.collections !== undefined || params.rules !== undefined;
            const response = hasTarget
                ? await sdk.graphql.execute(EXPORT_TAMPER_WITH_TARGET_MUTATION, {
                      input: { target: { collections: params.collections, rules: params.rules } },
                  })
                : await sdk.graphql.execute(EXPORT_TAMPER_MUTATION);
            return {
                content: [{ type: "text", text: stringifyResult(extractGraphqlResult(response)) }],
            };
        },
    });
};
