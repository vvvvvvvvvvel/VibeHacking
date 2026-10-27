/* eslint-disable @typescript-eslint/no-restricted-types */
import { z } from "zod";

import { GET_PROXY_TRAFFIC_CONTROL_QUERY, SET_PROXY_TRAFFIC_CONTROL_MUTATION } from "../graphql";
import type { GraphqlExecutor } from "../graphql";
import { ToolGroupId } from "../tool-permissions";

import { registerToolAction, type ToolContext } from "./register";
import { ciEnum, stringifyResult } from "./shared";

type TrafficControlOptions = {
    captureList: string[];
    passthroughList: string[];
    outOfScope: boolean;
};

type TrafficControlMode = "all" | "in_scope" | "custom";

type TrafficControlOutput = {
    mode: TrafficControlMode;
    captureList: string[];
    passthroughList: string[];
};

type TrafficControlResponse = {
    passthroughOptions?: TrafficControlOptions | null;
};

type SetTrafficControlResponse = {
    setPassthroughOptions?: {
        options?: TrafficControlOptions | null;
    };
};

const emptySchema = z.object({}).strict();

const optionalListSchema = z
    .array(z.string().min(1))
    .nullable()
    .default(null)
    .transform((value) => value ?? undefined);

const setTrafficControlSchema = z
    .object({
        mode: ciEnum(["all", "in_scope", "custom"]),
        capture_list: optionalListSchema,
        passthrough_list: optionalListSchema,
    })
    .strict();

const normalizeTrafficControl = (
    options: TrafficControlOptions | null | undefined,
): TrafficControlOutput => {
    if (options === null || options === undefined) {
        return { mode: "all", captureList: [], passthroughList: [] };
    }
    return {
        mode: options.outOfScope ? "in_scope" : "custom",
        captureList: options.captureList,
        passthroughList: options.passthroughList,
    };
};

const readTrafficControl = async (graphql: GraphqlExecutor) => {
    const response = await graphql.execute<TrafficControlResponse>(GET_PROXY_TRAFFIC_CONTROL_QUERY);
    return normalizeTrafficControl(response.data?.passthroughOptions);
};

const toMutationInput = (
    input: z.infer<typeof setTrafficControlSchema>,
    current: TrafficControlOutput,
) => {
    if (input.mode === "all") return null;
    if (input.mode === "in_scope") {
        return { captureList: [], passthroughList: [], outOfScope: true };
    }
    const keepCurrentLists = current.mode === "custom";
    return {
        captureList: input.capture_list ?? (keepCurrentLists ? current.captureList : []),
        passthroughList:
            input.passthrough_list ?? (keepCurrentLists ? current.passthroughList : []),
        outOfScope: false,
    };
};

export const registerTrafficControlTools = ({
    server,
    sdk,
    graphql,
    store,
    permissions,
}: ToolContext) => {
    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.proxyTrafficControl.getOptions",
        group: ToolGroupId.ProxyTrafficControlSafe,
        toolName: "get_proxy_traffic_control",
        description:
            "Get the proxy traffic-capture mode and custom capture/passthrough host lists. Modes are all, in_scope, and custom.",
        inputSchema: emptySchema,
        handler: async () => {
            const options = await readTrafficControl(graphql);
            return { content: [{ type: "text", text: stringifyResult(options) }] };
        },
    });

    registerToolAction(server, sdk, store, permissions, {
        action: "sdk.proxyTrafficControl.setOptions",
        group: ToolGroupId.ProxyTrafficControlUnsafe,
        toolName: "set_proxy_traffic_control",
        description:
            "Set the proxy traffic-capture mode. all captures all traffic; in_scope logs only in-scope traffic; custom applies capture_list and passthrough_list. Omitted custom lists retain existing custom values or default to empty lists.",
        inputSchema: setTrafficControlSchema,
        handler: async (params) => {
            const input = setTrafficControlSchema.parse(params);
            const before = await readTrafficControl(graphql);
            const response = await graphql.execute<SetTrafficControlResponse>(
                SET_PROXY_TRAFFIC_CONTROL_MUTATION,
                { input: toMutationInput(input, before) },
            );
            if (response.data?.setPassthroughOptions === undefined) {
                throw new Error("Caido did not return updated proxy traffic control options");
            }
            const after = normalizeTrafficControl(response.data.setPassthroughOptions.options);
            return {
                content: [{ type: "text", text: stringifyResult({ before, after }) }],
            };
        },
    });
};
