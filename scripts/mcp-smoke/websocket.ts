import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runWebsocket = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("WebSocket");

    let streamId: string | null = null;

    await runIfTool("list-websocket-streams", async () => {
        const res = await callTool("list-websocket-streams", { protocol: "WS" });
        const text = getToolText(res);
        const data = tryParseJSON<{ streams?: { edges?: Array<{ node?: { id?: string } }> } }>(
            text,
        );
        const id = data?.streams?.edges?.[0]?.node?.id;
        streamId = id != null ? Number(id) : streamId;
    });

    await runIfTool("list-websocket-streams-by-offset", async () => {
        const res = await callTool("list-websocket-streams-by-offset", {
            offset: 0,
            limit: 10,
            protocol: "WS",
        });
        const text = getToolText(res);
        const data = tryParseJSON<{ streamsByOffset?: { nodes?: Array<{ id?: string }> } }>(text);
        const id = data?.streamsByOffset?.nodes?.[0]?.id;
        streamId = id != null ? Number(id) : streamId;
    });

    await runIfTool("list-websocket-streams-by-direction", async () => {
        await callTool("list-websocket-streams-by-direction", {
            direction: "CLIENT",
            limit: 10,
            protocol: "WS",
        });
    });

    await runIfTool("get-websocket-stream", async () => {
        assert(streamId !== null, "no streams for get-websocket-stream");
        await callTool("get-websocket-stream", { ids: [streamId] });
    });

    let messageId: string | null = null;
    let editId: string | null = null;

    await runIfTool("list-websocket-messages", async () => {
        assert(streamId !== null, "no streams for list-websocket-messages");
        const res = await callTool("list-websocket-messages", {
            streamId,
            first: 10,
        });
        const text = getToolText(res);
        const data = tryParseJSON<{
            edges?: Array<{ node?: { id?: string; edits?: Array<{ id?: string }> } }>;
        }>(text);
        messageId = data?.edges?.[0]?.node?.id ?? messageId;
        editId = data?.edges?.[0]?.node?.edits?.[0]?.id ?? editId;
    });

    await runIfTool("list-websocket-messages-by-offset", async () => {
        assert(streamId !== null, "no streams for list-websocket-messages-by-offset");
        const res = await callTool("list-websocket-messages-by-offset", {
            streamId,
            offset: 0,
            limit: 10,
        });
        const text = getToolText(res);
        const data = tryParseJSON<{
            nodes?: Array<{ id?: string; edits?: Array<{ id?: string }> }>;
        }>(text);
        messageId = data?.nodes?.[0]?.id ?? messageId;
        editId = data?.nodes?.[0]?.edits?.[0]?.id ?? editId;
    });

    await runIfTool("get-websocket-message", async () => {
        assert(messageId !== null, "no messages for get-websocket-message");
        await callTool("get-websocket-message", { ids: [messageId] });
    });

    await runIfTool("get-websocket-message-edit", async () => {
        assert(editId !== null, "no message edits for get-websocket-message-edit");
        await callTool("get-websocket-message-edit", { ids: [editId] });
    });
};
