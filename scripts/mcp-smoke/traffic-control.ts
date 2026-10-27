import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

type TrafficControl = {
    mode: "all" | "in_scope" | "custom";
    capture_list: string[];
    passthrough_list: string[];
};

export const runTrafficControl = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Proxy traffic control");

    let current: TrafficControl | null = null;
    await runIfTool("get_proxy_traffic_control", async () => {
        const result = await callTool("get_proxy_traffic_control", {});
        current = tryParseJSON<TrafficControl>(getToolText(result));
        assert(current !== null, "traffic control options should be JSON");
        assert(
            current.mode === "all" || current.mode === "in_scope" || current.mode === "custom",
            "traffic control mode missing",
        );
        assert(Array.isArray(current.capture_list), "traffic control capture_list missing");
        assert(Array.isArray(current.passthrough_list), "traffic control passthrough_list missing");
    });

    await runIfTool("set_proxy_traffic_control", async () => {
        assert(current !== null, "no traffic control options for idempotent set");
        const input: Record<string, unknown> = { mode: current.mode };
        if (current.mode === "custom") {
            input.capture_list = current.capture_list;
            input.passthrough_list = current.passthrough_list;
        }
        const result = await callTool("set_proxy_traffic_control", input);
        const parsed = tryParseJSON<{ after?: TrafficControl }>(getToolText(result));
        assert(parsed?.after?.mode === current.mode, "traffic control mode changed unexpectedly");
    });
};
