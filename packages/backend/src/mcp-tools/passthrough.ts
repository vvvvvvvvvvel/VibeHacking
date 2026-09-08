import { z } from "zod";

import { GET_PASSTHROUGH_OPTIONS_QUERY, SET_PASSTHROUGH_OPTIONS_MUTATION } from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { stringifyResult } from "./shared";

type PassthroughOptionsObject = {
    allowlist?: string[];
    denylist?: string[];
    outOfScope?: boolean;
};

type PassthroughOptionsResponse = {
    passthroughOptions?: {
        passthroughOptions?: PassthroughOptionsObject;
    };
};

type SetPassthroughOptionsResponse = {
    setPassthroughOptions?: {
        options?: {
            passthroughOptions?: PassthroughOptionsObject;
        };
    };
};

const emptySchema = z.object({}).strict();

const passthroughListSchema = z
    .array(z.string().min(1))
    .nullable()
    .optional()
    .transform((value) => value ?? undefined);

const setPassthroughOptionsSchema = z
    .object({
        allowlist: passthroughListSchema,
        denylist: passthroughListSchema,
        out_of_scope: z.boolean().optional(),
    })
    .strict()
    .refine(
        (value) =>
            value.allowlist !== undefined ||
            value.denylist !== undefined ||
            value.out_of_scope !== undefined,
        "Provide allowlist, denylist, or out_of_scope",
    );

const normalizePassthroughOptions = (options: PassthroughOptionsObject | undefined) => ({
    allowlist: options?.allowlist ?? [],
    denylist: options?.denylist ?? [],
    outOfScope: options?.outOfScope ?? false,
});

const readPassthroughOptions = async (sdk: ToolContext["sdk"]) => {
    const response = await sdk.graphql.execute<PassthroughOptionsResponse>(
        GET_PASSTHROUGH_OPTIONS_QUERY,
        {},
    );
    return normalizePassthroughOptions(response.data?.passthroughOptions?.passthroughOptions);
};

export const registerPassthroughTools = ({ server, sdk, store, permissions }: ToolContext) => {
    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.proxyPassthrough.getOptions",
        group: ToolGroupId.ProxyPassthroughSafe,
        toolName: "get_proxy_passthrough_options",
        description:
            "Get Caido proxy passthrough options: allowlist, denylist, and out-of-scope passthrough.",
        inputSchema: emptySchema,
        handler: async () => {
            const options = await readPassthroughOptions(sdk);
            return { content: [{ type: "text", text: stringifyResult(options) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.proxyPassthrough.setOptions",
        group: ToolGroupId.ProxyPassthroughUnsafe,
        toolName: "set_proxy_passthrough_options",
        description:
            "Update Caido proxy passthrough options. Omitted fields keep their current values; pass [] to clear allowlist or denylist.",
        inputSchema: setPassthroughOptionsSchema,
        handler: async (params) => {
            const input = setPassthroughOptionsSchema.parse(params);
            const before = await readPassthroughOptions(sdk);
            const next = {
                allowlist: input.allowlist ?? before.allowlist,
                denylist: input.denylist ?? before.denylist,
                outOfScope: input.out_of_scope ?? before.outOfScope,
            };
            const response = await sdk.graphql.execute<SetPassthroughOptionsResponse>(
                SET_PASSTHROUGH_OPTIONS_MUTATION,
                {
                    input: {
                        targets: {
                            allowlist: next.allowlist,
                            denylist: next.denylist,
                        },
                        outofscope: next.outOfScope,
                    },
                },
            );
            const after = normalizePassthroughOptions(
                response.data?.setPassthroughOptions?.options?.passthroughOptions,
            );
            return {
                content: [
                    {
                        type: "text",
                        text: stringifyResult({
                            before,
                            after,
                        }),
                    },
                ],
            };
        },
    });
};
