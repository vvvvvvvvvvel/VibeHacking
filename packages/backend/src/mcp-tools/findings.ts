import { z } from "zod";

import { DELETE_FINDINGS_MUTATION, UPDATE_FINDING_MUTATION } from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult, toDedupeKey, toId, toNumericId } from "./shared";

export const registerFindingsTools = ({
    server,
    sdk,
    store,
    permissions,
    toolsByAction,
}: ToolContext) => {
    const normalizeInputs = (input: { dedupeKeys?: string[]; requestIds?: string[] }) => {
        const normalizedDedupeKeys = input.dedupeKeys?.filter((key) => key.length > 0) ?? [];
        const normalizedRequestIds = input.requestIds?.filter((id) => id.length > 0) ?? [];
        return {
            normalizedDedupeKeys,
            normalizedRequestIds,
            hasDedupeKeys: normalizedDedupeKeys.length > 0,
            hasRequestIds: normalizedRequestIds.length > 0,
        };
    };

    const requestIdSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const requestIdArraySchema = z.array(requestIdSchema);
    const dedupeKeyArraySchema = z.array(z.string().min(1));
    const findingGetSchema = z
        .object({
            requestIds: requestIdArraySchema.optional(),
            reporter: z.string().min(1).optional(),
            dedupeKeys: dedupeKeyArraySchema.optional(),
        })
        .strict()
        .refine(
            (value) =>
                Boolean(value.dedupeKeys && value.dedupeKeys.length) !==
                Boolean(value.requestIds && value.requestIds.length),
            {
                message: "Provide either dedupeKeys or requestIds",
            },
        );
    const idSchema = z.preprocess(
        (value) => (typeof value === "number" ? String(value) : value),
        z.string().min(1),
    );
    const findingCreateItemSchema = z
        .object({
            title: z.string().min(1),
            description: z.string().optional(),
            reporter: z.string().min(1),
            dedupeKey: z.string().min(1).optional(),
            requestId: idSchema,
        })
        .strict();
    const findingCreateSchema = z
        .object({ items: z.array(findingCreateItemSchema).min(1) })
        .strict();
    const findingUpdateItemSchema = z
        .object({
            id: idSchema,
            input: z
                .object({
                    title: z.string().min(1).optional(),
                    description: z.string().optional(),
                    hidden: z.boolean().optional(),
                })
                .strict()
                .refine(
                    (value) =>
                        value.title !== undefined ||
                        value.description !== undefined ||
                        value.hidden !== undefined,
                    { message: "Provide at least one field to update" },
                ),
        })
        .strict();
    const findingUpdateSchema = z
        .object({ items: z.array(findingUpdateItemSchema).min(1) })
        .strict();
    const findingDeleteSchema = z
        .object({
            ids: z.array(idSchema).min(1),
            reporter: z.string().min(1).optional(),
        })
        .strict();

    toolsByAction.set(
        "sdk.findings.get",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.findings.get",
            group: ToolGroupId.FindingSafe,
            toolName: "get-finding",
            description:
                "Get findings by requestIds or dedupeKeys (choose one). " +
                'Example: { "requestIds": [1] } or { "dedupeKeys": ["my-key"] }.',
            inputSchema: findingGetSchema,
            handler: async (params) => {
                const { dedupeKeys, requestIds, reporter } = params as {
                    dedupeKeys?: string[];
                    requestIds?: string[];
                    reporter?: string;
                };
                const { normalizedDedupeKeys, normalizedRequestIds, hasDedupeKeys, hasRequestIds } =
                    normalizeInputs({ dedupeKeys, requestIds });
                if (!hasDedupeKeys && !hasRequestIds) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "error: provide either dedupeKeys (array) or requestIds (array)",
                            },
                        ],
                    };
                }
                if (hasDedupeKeys) {
                    const results = [];
                    for (const key of normalizedDedupeKeys) {
                        const finding = await sdk.findings.get(toDedupeKey(key));
                        if (finding === undefined || finding === null) {
                            results.push({ dedupeKey: key, found: false });
                            continue;
                        }
                        results.push({
                            dedupeKey: key,
                            found: true,
                            id: String(finding.getId()),
                            title: finding.getTitle(),
                            description: finding.getDescription(),
                            reporter: finding.getReporter(),
                            requestId: finding.getRequestId(),
                        });
                    }
                    return { content: [{ type: "text", text: stringifyResult(results) }] };
                }
                const ids = normalizedRequestIds;
                const results = [];
                for (const id of ids) {
                    const entry = await sdk.requests.get(toId(id));
                    const request = entry?.request;
                    if (request === undefined) {
                        results.push({ requestId: id, found: false, error: "(request not found)" });
                        continue;
                    }
                    const finding = await sdk.findings.get({
                        request,
                        reporter,
                    });
                    if (finding === undefined || finding === null) {
                        results.push({ requestId: id, found: false });
                        continue;
                    }
                    results.push({
                        requestId: id,
                        found: true,
                        id: String(finding.getId()),
                        title: finding.getTitle(),
                        description: finding.getDescription(),
                        reporter: finding.getReporter(),
                        dedupeKey: finding.getDedupeKey(),
                    });
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            },
        }),
    );

    toolsByAction.set(
        "sdk.findings.exists",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.findings.exists",
            group: ToolGroupId.FindingSafe,
            toolName: "finding-exists",
            description:
                "Check existence by requestIds or dedupeKeys (choose one). " +
                'Example: { "requestIds": [1] } or { "dedupeKeys": ["my-key"] }.',
            inputSchema: findingGetSchema,
            handler: async (params) => {
                const { dedupeKeys, requestIds, reporter } = params as {
                    dedupeKeys?: string[];
                    requestIds?: string[];
                    reporter?: string;
                };
                const { normalizedDedupeKeys, normalizedRequestIds, hasDedupeKeys, hasRequestIds } =
                    normalizeInputs({ dedupeKeys, requestIds });
                if (!hasDedupeKeys && !hasRequestIds) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "error: provide either dedupeKeys (array) or requestIds (array)",
                            },
                        ],
                    };
                }
                if (hasDedupeKeys) {
                    const results = [];
                    for (const key of normalizedDedupeKeys) {
                        const exists = await sdk.findings.exists(toDedupeKey(key));
                        results.push({ dedupeKey: key, exists });
                    }
                    return { content: [{ type: "text", text: stringifyResult(results) }] };
                }
                const ids = normalizedRequestIds;
                const results = [];
                for (const id of ids) {
                    const entry = await sdk.requests.get(toId(id));
                    const request = entry?.request;
                    if (request === undefined) {
                        results.push({
                            requestId: id,
                            exists: false,
                            error: "(request not found)",
                        });
                        continue;
                    }
                    const exists = await sdk.findings.exists({
                        request,
                        reporter,
                    });
                    results.push({ requestId: id, exists });
                }
                return { content: [{ type: "text", text: stringifyResult(results) }] };
            },
        }),
    );

    toolsByAction.set(
        "sdk.findings.create",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.findings.create",
            group: ToolGroupId.FindingSafe,
            toolName: "create-finding",
            description:
                "Create findings for saved requests. " +
                'Example: { "items": [{ "title": "Auth bypass", "reporter": "mcp", "requestId": 1 }] }.',
            inputSchema: findingCreateSchema,
            handler: async (params) => {
                const { items } = findingCreateSchema.parse(params);
                const results = [];
                for (const item of items) {
                    const entry = await sdk.requests.get(toId(item.requestId));
                    const request = entry?.request;
                    if (request === undefined) {
                        results.push({
                            requestId: item.requestId,
                            error: "(request not found)",
                        });
                        continue;
                    }
                    const finding = await sdk.findings.create({
                        title: item.title,
                        description: item.description,
                        reporter: item.reporter,
                        dedupeKey: item.dedupeKey,
                        request,
                    });
                    results.push({
                        id: toNumericId(String(finding.getId())),
                        title: finding.getTitle(),
                        reporter: finding.getReporter(),
                        requestId: toNumericId(String(finding.getRequestId())),
                    });
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: stringifyResult(results),
                        },
                    ],
                };
            },
        }),
    );

    toolsByAction.set(
        "sdk.findings.update",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.findings.update",
            group: ToolGroupId.FindingUnsafe,
            toolName: "update-finding",
            description:
                "Update findings by ID. " +
                'Example: { "items": [{ "id": 1, "input": { "title": "Updated" } }] }.',
            inputSchema: findingUpdateSchema,
            handler: async (params) => {
                const { items } = findingUpdateSchema.parse(params);
                const results = await Promise.all(
                    items.map(async (item) => {
                        const response = await sdk.graphql.execute(UPDATE_FINDING_MUTATION, item);
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
        "sdk.findings.delete",
        registerToolAction(server, sdk, store, permissions, {
            action: "sdk.findings.delete",
            group: ToolGroupId.FindingUnsafe,
            toolName: "delete-finding",
            description: 'Delete findings by IDs. Example: { "ids": [1] }.',
            inputSchema: findingDeleteSchema,
            handler: async (params) => {
                const { ids, reporter } = params as { ids: string[]; reporter?: string };
                const response = await sdk.graphql.execute(DELETE_FINDINGS_MUTATION, {
                    input: { ids, reporter },
                });
                const errors = (response as { errors?: Array<{ message?: string }> }).errors;
                const hasUnknownInput =
                    errors?.some((error) =>
                        String(error?.message ?? "").includes('Unknown argument "input"'),
                    ) ?? false;
                if (hasUnknownInput) {
                    const fallback = await sdk.graphql.execute(
                        `
                          mutation deleteFindings($ids: [ID!]!, $reporter: String) {
                            deleteFindings(ids: $ids, reporter: $reporter) {
                              deletedIds
                            }
                          }
                        `,
                        { ids, reporter },
                    );
                    return {
                        content: [
                            { type: "text", text: stringifyResult(fallback.data ?? fallback) },
                        ],
                    };
                }
                return {
                    content: [{ type: "text", text: stringifyResult(response.data ?? response) }],
                };
            },
        }),
    );
};
