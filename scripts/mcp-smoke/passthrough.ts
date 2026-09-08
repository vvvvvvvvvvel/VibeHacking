import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

type PassthroughOptions = {
    allowlist?: string[];
    denylist?: string[];
    out_of_scope?: boolean;
};

export const runPassthrough = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Proxy passthrough");

    let current: PassthroughOptions | null = null;

    await runIfTool("get_proxy_passthrough_options", async () => {
        const res = await callTool("get_proxy_passthrough_options", {});
        const text = getToolText(res);
        current = tryParseJSON<PassthroughOptions>(text);
        assert(current !== null, "passthrough options should be JSON");
        assert(Array.isArray(current.allowlist), "passthrough allowlist missing");
        assert(Array.isArray(current.denylist), "passthrough denylist missing");
        assert(typeof current.out_of_scope === "boolean", "passthrough out_of_scope missing");
    });

    await runIfTool("set_proxy_passthrough_options", async () => {
        assert(current !== null, "no passthrough options for idempotent set");
        const res = await callTool("set_proxy_passthrough_options", {
            allowlist: current.allowlist ?? [],
            denylist: current.denylist ?? [],
            out_of_scope: current.out_of_scope ?? false,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ after?: PassthroughOptions }>(text);
        assert(Array.isArray(parsed?.after?.allowlist), "set passthrough allowlist missing");
        assert(Array.isArray(parsed?.after?.denylist), "set passthrough denylist missing");
        assert(
            typeof parsed?.after?.out_of_scope === "boolean",
            "set passthrough out_of_scope missing",
        );
    });
};
