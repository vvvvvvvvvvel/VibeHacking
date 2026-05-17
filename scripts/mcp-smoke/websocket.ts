import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runWebsocket = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("WebSocket");

    let stream_id: string | null = null;

    await runIfTool("list_websocket_streams", async () => {
        const res = await callTool("list_websocket_streams", {
            limit: 10,
            protocol: "WS",
        });
        const text = getToolText(res);
        const data = tryParseJSON<{ page_info?: any; items?: Array<{ id?: string | number }> }>(
            text,
        );
        assert(data?.page_info !== undefined, "list_websocket_streams page_info missing");
        assert(Array.isArray(data?.items), "list_websocket_streams items missing");
        const id = data?.items?.[0]?.id;
        stream_id = id != null ? String(id) : stream_id;

        const firstPage = await callTool("list_websocket_streams", {
            limit: 1,
            protocol: "WS",
        });
        const firstData = tryParseJSON<{
            page_info?: any;
            items?: Array<{ id?: string | number; cursor?: string }>;
        }>(getToolText(firstPage));
        assert(firstData?.page_info !== undefined, "stream cursor page_info missing");
        assert(Array.isArray(firstData?.items), "stream cursor items missing");
        const firstCursorItem = firstData?.items?.[0];
        if (firstCursorItem?.id != null && firstData?.page_info?.has_next_page) {
            const nextPage = await callTool("list_websocket_streams", {
                limit: 1,
                protocol: "WS",
                cursor: firstData.page_info.end_cursor,
            });
            const nextData = tryParseJSON<{
                page_info?: any;
                items?: Array<{ id?: string | number }>;
            }>(getToolText(nextPage));
            const next = nextData?.items?.[0];
            assert(next?.id != null, "stream cursor after returned no next item");
            assert(
                String(next.id) !== String(firstCursorItem.id),
                "stream cursor after returned same item",
            );
            const backPage = await callTool("list_websocket_streams", {
                limit: 1,
                protocol: "WS",
                cursor: nextData?.page_info?.start_cursor,
                direction: "before",
            });
            const backData = tryParseJSON<{ items?: Array<{ id?: string | number }> }>(
                getToolText(backPage),
            );
            assert(
                String(backData?.items?.[0]?.id) === String(firstCursorItem.id),
                "stream cursor before did not return previous item",
            );
        }

        const ascPage = await callTool("list_websocket_streams", {
            limit: 1,
            protocol: "WS",
            order: { by: "ID", ordering: "ASC" },
        });
        const ascData = tryParseJSON<{ items?: Array<{ id?: string | number }> }>(
            getToolText(ascPage),
        );
        if (firstCursorItem?.id != null && ascData?.items?.[0]?.id != null) {
            assert(
                Number(ascData.items[0].id) <= Number(firstCursorItem.id),
                "stream ASC order should start from lower id than default DESC",
            );
        }
    });

    await runIfTool("get_websocket_streams_by_ids", async () => {
        if (stream_id === null) {
            console.log("- skip get_websocket_streams_by_ids (no streams)");
            return;
        }
        await callTool("get_websocket_streams_by_ids", { ids: [stream_id] });
    });

    let messageId: string | null = null;
    let editId: string | null = null;

    await runIfTool("list_websocket_messages", async () => {
        if (stream_id === null) {
            console.log("- skip list_websocket_messages exact stream checks (no streams)");
            return;
        }
        const res = await callTool("list_websocket_messages", {
            stream_id,
            limit: 10,
            fields: ["cursor", "id", "direction", "payload.text", "stream_id"],
        });
        const text = getToolText(res);
        const data = tryParseJSON<{
            page_info?: any;
            items?: Array<{
                id?: string | number;
                cursor?: string;
                payload?: { text?: string };
            }>;
        }>(text);
        assert(data?.page_info !== undefined, "list_websocket_messages page_info missing");
        assert(Array.isArray(data?.items), "list_websocket_messages items missing");
        const id = data?.items?.[0]?.id;
        messageId = id != null ? String(id) : messageId;
        if (data?.items?.[0] !== undefined) {
            assert(data.items[0].cursor, "projected websocket message cursor missing");
            assert(
                data.items[0].payload?.text !== undefined,
                "projected websocket message payload.text missing",
            );
        }

        const firstPage = await callTool("list_websocket_messages", {
            stream_id,
            limit: 1,
            fields: ["cursor", "id", "payload.text", "stream_id"],
        });
        const firstData = tryParseJSON<{
            page_info?: any;
            items?: Array<{ id?: string | number; cursor?: string; payload?: { text?: string } }>;
        }>(getToolText(firstPage));
        assert(firstData?.page_info !== undefined, "message cursor page_info missing");
        assert(Array.isArray(firstData?.items), "message cursor items missing");
        const firstCursorItem = firstData?.items?.[0];
        if (firstCursorItem?.id != null && firstData?.page_info?.has_next_page) {
            const nextPage = await callTool("list_websocket_messages", {
                stream_id,
                limit: 1,
                cursor: firstData.page_info.end_cursor,
                fields: ["cursor", "id"],
            });
            const nextData = tryParseJSON<{
                page_info?: any;
                items?: Array<{ id?: string | number }>;
            }>(getToolText(nextPage));
            const next = nextData?.items?.[0];
            assert(next?.id != null, "message cursor after returned no next item");
            assert(
                String(next.id) !== String(firstCursorItem.id),
                "message cursor after returned same item",
            );
            const backPage = await callTool("list_websocket_messages", {
                stream_id,
                limit: 1,
                cursor: nextData?.page_info?.start_cursor,
                direction: "before",
                fields: ["id"],
            });
            const backData = tryParseJSON<{ items?: Array<{ id?: string | number }> }>(
                getToolText(backPage),
            );
            assert(
                String(backData?.items?.[0]?.id) === String(firstCursorItem.id),
                "message cursor before did not return previous item",
            );
        }

        const resFull = await callTool("list_websocket_messages", {
            stream_id,
            limit: 10,
        });
        const fullText = getToolText(resFull);
        const fullData = tryParseJSON<{ items?: Array<any> }>(fullText);
        const fullFirst = fullData?.items?.[0];
        if (fullFirst !== undefined) {
            assert(fullFirst.payload?.encoding === "text", "websocket payload should be text");
            assert(fullFirst.edited_payload === null, "edited_payload should be null by default");
        }
        const discoveredEdit = fullFirst?.edit_ids?.[0] ?? fullFirst?.head_id;
        editId = discoveredEdit != null ? String(discoveredEdit) : editId;

        if (fullFirst?.id != null) {
            const ascPage = await callTool("list_websocket_messages", {
                stream_id,
                limit: 1,
                order: { by: "ID", ordering: "ASC" },
                fields: ["id"],
            });
            const ascData = tryParseJSON<{ items?: Array<{ id?: string | number }> }>(
                getToolText(ascPage),
            );
            if (ascData?.items?.[0]?.id != null) {
                assert(
                    Number(ascData.items[0].id) <= Number(fullFirst.id),
                    "message ASC order should start from lower id than default DESC",
                );
            }

            const withEdited = await callTool("list_websocket_messages", {
                stream_id,
                limit: 1,
                serialization: { include_edited_payload: true },
            });
            const withEditedData = tryParseJSON<{ items?: Array<any> }>(getToolText(withEdited));
            if (withEditedData?.items?.[0]?.edit_ids?.length > 0) {
                assert(
                    withEditedData.items[0].edited_payload?.encoding === "text",
                    "include_edited_payload did not materialize edited_payload",
                );
            }

            const excluded = await callTool("list_websocket_messages", {
                stream_id,
                limit: 1,
                exclude_fields: ["stream", "edited_payload"],
            });
            const excludedData = tryParseJSON<{ items?: Array<any> }>(getToolText(excluded));
            if (excludedData?.items?.[0] !== undefined) {
                assert(
                    excludedData.items[0].stream === undefined,
                    "exclude_fields should remove stream",
                );
                assert(
                    excludedData.items[0].edited_payload === undefined,
                    "exclude_fields should remove edited_payload",
                );
            }
        }
    });

    await runIfTool("get_websocket_messages_by_ids", async () => {
        if (messageId === null) {
            console.log("- skip get_websocket_messages_by_ids (no messages)");
            return;
        }
        await callTool("get_websocket_messages_by_ids", {
            ids: [messageId],
            serialization: { include_edited_payload: true },
            fields: ["id", "payload.text", "edited_payload.text", "stream.id"],
        });
    });

    await runIfTool("get_websocket_message_edits_by_ids", async () => {
        if (editId === null) {
            console.log("- skip get_websocket_message_edits_by_ids (no message edits)");
            return;
        }
        await callTool("get_websocket_message_edits_by_ids", { ids: [editId] });
    });
};
