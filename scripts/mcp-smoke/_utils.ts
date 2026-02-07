/* eslint-disable no-console */
type Fetch = (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const fetchFn = (globalThis as unknown as { fetch?: Fetch }).fetch;
if (!fetchFn) {
    throw new Error("global fetch is not available. Use Node 18+.");
}

export const MCP_URL = process.env.MCP_URL ?? "http://127.0.0.1:3333/mcp";

let rpcId = 1;

export const rpc = async (method: string, params?: Record<string, unknown>, withId = true) => {
    const body: Record<string, unknown> = {
        jsonrpc: "2.0",
        method,
    };
    if (withId) {
        body.id = rpcId++;
    }
    if (params) {
        body.params = params;
    }

    const res = await fetchFn(MCP_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
    }
    if (!withId) {
        return null;
    }
    return JSON.parse(text) as { result?: unknown; error?: unknown };
};

export const getToolText = (result: unknown): string => {
    const data = result as { content?: Array<{ type: string; text: string }> };
    return data?.content?.[0]?.text ?? "";
};

export const isToolError = (result: unknown): boolean => {
    const data = result as { isError?: boolean; content?: Array<{ type: string; text: string }> };
    if (data?.isError) return true;
    const text = data?.content?.[0]?.text ?? "";
    return text.startsWith("MCP error");
};

export const tryParseJSON = <T>(text: string): T | null => {
    try {
        return JSON.parse(text) as T;
    } catch {
        return null;
    }
};

export const assert = (cond: boolean, message: string) => {
    if (!cond) {
        throw new Error(message);
    }
};

export const logStep = (label: string) => {
    console.log(`\n== ${label}`);
};

export const logJSON = (label: string, value: unknown) => {
    console.log(`${label}: ${JSON.stringify(value)}`);
};

export type ToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export const initSession = async () => {
    logStep("Initialize");
    const init = await rpc("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-smoke", version: "0.0.1" },
    });
    assert(!init?.error, "initialize failed");
    await rpc("notifications/initialized", undefined, false);
};

export const makeToolCaller = (tools: Set<string>) => {
    const callTool: ToolCall = async (name, args) => {
        logJSON(`tool:${name}:args`, args);
        const res = await rpc("tools/call", { name, arguments: args });
        if (res?.error) {
            logJSON(`tool:${name}:error`, res.error);
            throw new Error(`tool ${name} failed`);
        }
        logJSON(`tool:${name}:result`, res?.result);
        if (isToolError(res?.result)) {
            throw new Error(`tool ${name} returned error`);
        }
        const text = getToolText(res?.result);
        const parsed = tryParseJSON<{ errors?: Array<unknown> }>(text);
        if (parsed?.errors?.length) {
            logJSON(`tool:${name}:graphql-errors`, parsed.errors);
            throw new Error(`tool ${name} returned GraphQL errors`);
        }
        return res?.result;
    };

    const runIfTool = async (name: string, fn: () => Promise<void>) => {
        assert(tools.has(name), `tool ${name} not available`);
        await fn();
        console.log(`- ok ${name}`);
    };

    return { callTool, runIfTool };
};
