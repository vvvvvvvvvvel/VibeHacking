import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

const assertBodyOmitted = (label: string, payload: any) => {
    if (!payload) return;
    assert(payload.body === null, `${label} body should be null`);
    assert(payload.raw === null, `${label} raw should be null`);
    assert(payload.body_encoding === "omitted", `${label} body_encoding should be omitted`);
};

const assertBodyIncluded = (label: string, payload: any) => {
    if (!payload) return;
    assert(payload.raw !== null, `${label} raw should be present`);
};

const pickFirstRequestId = async (
    callTool: (n: string, a: Record<string, unknown>) => Promise<unknown>,
) => {
    const res = await callTool("list_requests", {
        limit: 1,
        fields: ["id"],
    });
    const text = getToolText(res);
    const parsed = tryParseJSON<{ items?: Array<any> }>(text);
    const first = parsed?.items?.[0]?.id ?? null;
    return first ? String(first) : null;
};

export const runReplay = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Replay");

    let requestId: string | null = null;
    let requestIdNum: number | null = null;
    if (tools.has("list_requests")) {
        requestId = await pickFirstRequestId(callTool);
        requestIdNum = requestId ? Number(requestId) : null;
        assert(requestId !== null, "no saved requests found for replay");
    }

    let collectionId: number | null = null;
    let sessionId: number | null = null;
    let entryId: number | null = null;
    let missingRequestEntryId: number | null = null;
    let pipelineEntryId: number | null = null;
    let pipelineHttpEntryId: number | null = null;

    await runIfTool("create_replay_collection", async () => {
        const name = `smoke-${Date.now()}`;
        const res = await callTool("create_replay_collection", { names: [name] });
        const text = getToolText(res);
        const parsed = tryParseJSON<Array<{ id?: string }>>(text);
        collectionId = parsed?.[0]?.id != null ? Number(parsed[0].id) : null;
        assert(collectionId !== null, "replay collection id missing");
    });

    await runIfTool("query_replay_collections", async () => {
        await callTool("query_replay_collections", { first: 5 });
    });

    await runIfTool("list_replay_collections_detailed", async () => {
        const res = await callTool("list_replay_collections_detailed", {
            first: 1,
            include_request: true,
            only_latest_entry_details: true,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{
            replay_session_collections?: { nodes?: Array<any> };
            data?: { replay_session_collections?: { nodes?: Array<any> } };
        }>(text);
        const nodes =
            parsed?.replay_session_collections?.nodes ??
            parsed?.data?.replay_session_collections?.nodes ??
            [];
        for (const collection of nodes) {
            for (const session of collection.sessions ?? []) {
                const entries = session.entries?.nodes ?? [];
                const found = entries.find((entry: any) => entry?.id)?.id;
                const detailsEntry = entries.find((entry: any) => entry?.request_details);
                if (detailsEntry?.request_details) {
                    assertBodyOmitted(
                        "list_replay_collections_detailed request_details (default)",
                        detailsEntry.request_details,
                    );
                }
                if (detailsEntry?.response_details) {
                    assertBodyOmitted(
                        "list_replay_collections_detailed response_details (default)",
                        detailsEntry.response_details,
                    );
                }
                const missingRequestEntry = entries.find(
                    (entry: any) =>
                        entry &&
                        !entry.request &&
                        (entry.raw || entry.request_raw_base64 || entry.request_raw_utf8),
                );
                if (missingRequestEntry) {
                    missingRequestEntryId = Number(missingRequestEntry.id);
                    assert(
                        typeof missingRequestEntry.request_raw_base64 === "string",
                        "list_replay_collections_detailed should include request_raw_base64 when request missing",
                    );
                }
                if (found) {
                    entryId = Number(found);
                    return;
                }
            }
        }
    });

    await runIfTool("query_replay_sessions", async () => {
        const res = await callTool("query_replay_sessions", { first: 5 });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ replay_sessions?: { nodes?: Array<any> } }>(text);
        const first = parsed?.replay_sessions?.nodes?.[0]?.id ?? null;
        sessionId = first != null ? Number(first) : sessionId;
    });

    await runIfTool("create_replay_session", async () => {
        assert(requestId !== null, "no request for create_replay_session");
        assert(requestIdNum !== null, "no numeric request for create_replay_session");
        const res = await callTool("create_replay_session", {
            request_ids: [requestIdNum],
            collection_id: collectionId ?? undefined,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<Array<{ id?: string }>>(text);
        const created = parsed?.[0]?.id;
        if (created != null) {
            sessionId = Number(created);
        }
    });

    await runIfTool("send_to_replay", async () => {
        assert(requestId !== null, "no request for send_to_replay");
        assert(requestIdNum !== null, "no numeric request for send_to_replay");
        await callTool("send_to_replay", {
            request_ids: [requestIdNum],
            collection_id: collectionId ?? undefined,
            session_name: "smoke",
        });
    });

    await runIfTool("send_to_replay_from_filter", async () => {
        await callTool("send_to_replay_from_filter", {
            filter: 'req.method.eq:"GET"',
            limit: 1,
            collection_id: collectionId ?? undefined,
        });
    });

    await runIfTool("create_replay_pipeline_session", async () => {
        assert(requestIdNum !== null, "no numeric request for create_replay_pipeline_session");
        const res = await callTool("create_replay_pipeline_session", {
            request_ids: [requestIdNum],
            collection_id: collectionId ?? undefined,
            session_name: "smoke-pipeline",
            strategy: { type: "sequential", abort_on_failure: true },
            entry_limit: 5,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{
            session?: {
                id?: number | string;
                entries?: { nodes?: Array<any> };
            };
            error?: unknown;
        }>(text);
        assert(parsed?.session?.id, "pipeline session id missing");
        sessionId = Number(parsed.session.id);
        const firstEntry = parsed.session.entries?.nodes?.[0];
        if (firstEntry?.id != null) {
            pipelineEntryId = Number(firstEntry.id);
            pipelineHttpEntryId =
                firstEntry.active_http_entry?.id != null
                    ? Number(firstEntry.active_http_entry.id)
                    : firstEntry.http_entries?.[0]?.id != null
                      ? Number(firstEntry.http_entries[0].id)
                      : null;
        }
    });

    await runIfTool("set_replay_pipeline_active_http_entry", async () => {
        if (pipelineEntryId === null || pipelineHttpEntryId === null) return;
        await callTool("set_replay_pipeline_active_http_entry", {
            pipeline_entry_id: pipelineEntryId,
            http_entry_id: pipelineHttpEntryId,
        });
    });

    await runIfTool("list_replay_collections_detailed", async () => {
        if (missingRequestEntryId) {
            return;
        }
        const res = await callTool("list_replay_collections_detailed", {
            first: 5,
            include_request: true,
            only_latest_entry_details: false,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{
            replay_session_collections?: { nodes?: Array<any> };
            data?: { replay_session_collections?: { nodes?: Array<any> } };
        }>(text);
        const nodes =
            parsed?.replay_session_collections?.nodes ??
            parsed?.data?.replay_session_collections?.nodes ??
            [];
        for (const collection of nodes) {
            for (const session of collection.sessions ?? []) {
                const entries = session.entries?.nodes ?? [];
                const missing = entries.find(
                    (entry: any) =>
                        entry &&
                        !entry.request &&
                        (entry.raw || entry.request_raw_base64 || entry.request_raw_utf8),
                );
                if (missing) {
                    missingRequestEntryId = Number(missing.id);
                    return;
                }
            }
        }
    });

    await runIfTool("get_replay_session", async () => {
        assert(sessionId !== null, "no session for get_replay_session");
        await callTool("get_replay_session", { session_ids: [sessionId] });

        const missingRes = await callTool("get_replay_session", {
            session_ids: ["2147483647"],
        });
        const missingText = getToolText(missingRes);
        const missingParsed = tryParseJSON<Array<{ id?: number; error?: unknown }>>(missingText);
        assert(
            missingParsed?.[0]?.id === 2147483647 && missingParsed[0].error === "not found",
            "get_replay_session missing ID should return a structured error",
        );
    });

    const runGetReplayEntryChecks = async () => {
        if (entryId) {
            const res = await callTool("get_replay_entry", {
                entry_ids: [entryId],
                include_request: true,
            });
            const text = getToolText(res);
            const parsed = tryParseJSON<any[]>(text);
            const first = parsed?.[0];
            const details = first?.request_details;
            const response_details = first?.response_details;
            if (details) {
                assertBodyIncluded("get_replay_entry request_details (default)", details);
            }
            if (response_details) {
                assertBodyIncluded("get_replay_entry response_details (default)", response_details);
            }

            const resNoBody = await callTool("get_replay_entry", {
                entry_ids: [entryId],
                include_request: true,
                serialization: { include_body: false },
            });
            const textNoBody = getToolText(resNoBody);
            const parsedNoBody = tryParseJSON<any[]>(textNoBody);
            const firstNoBody = parsedNoBody?.[0];
            const detailsNoBody = firstNoBody?.request_details;
            const responseNoBody = firstNoBody?.response_details;
            if (detailsNoBody) {
                assertBodyOmitted(
                    "get_replay_entry request_details (includeBody=false)",
                    detailsNoBody,
                );
            }
            if (responseNoBody) {
                assertBodyOmitted(
                    "get_replay_entry response_details (includeBody=false)",
                    responseNoBody,
                );
            }
        } else {
            assert(entryId !== null, "no entry for get_replay_entry request-details checks");
        }

        if (missingRequestEntryId) {
            const resMissing = await callTool("get_replay_entry", {
                entry_ids: [missingRequestEntryId],
                include_request: true,
                include_raw_when_request_missing: true,
            });
            const textMissing = getToolText(resMissing);
            const parsedMissing = tryParseJSON<any[]>(textMissing);
            const firstMissing = parsedMissing?.[0];
            if (firstMissing?.replay_entry?.request === null) {
                assert(
                    typeof firstMissing?.request_raw_base64 === "string",
                    "get_replay_entry should include request_raw_base64 when request missing",
                );
            }
        }
    };

    await runIfTool("move_replay_session", async () => {
        assert(sessionId !== null, "no session for move_replay_session");
        assert(collectionId !== null, "no collection for move_replay_session");
        await callTool("move_replay_session", {
            items: [{ ids: [sessionId], collection_id: collectionId }],
        });
    });

    await runIfTool("rename_replay_collection", async () => {
        assert(collectionId !== null, "no collection for rename_replay_collection");
        await callTool("rename_replay_collection", {
            items: [{ id: collectionId, name: `smoke-${Date.now()}-renamed` }],
        });
    });

    await runIfTool("rename_replay_session", async () => {
        assert(sessionId !== null, "no session for rename_replay_session");
        await callTool("rename_replay_session", {
            items: [{ id: sessionId, name: `smoke-${Date.now()}-renamed` }],
        });
    });

    await runIfTool("start_replay_task", async () => {
        assert(sessionId !== null, "no session for start_replay_task");
        const res = await callTool("start_replay_task", {
            session_ids: [sessionId],
        });
        if (!entryId) {
            const text = getToolText(res);
            const parsed = tryParseJSON<Array<any>>(text);
            const createdEntryId = parsed?.[0]?.result?.start_replay_task?.task?.replay_entry?.id;
            if (createdEntryId != null) {
                entryId = Number(createdEntryId);
            }
        }
        await runGetReplayEntryChecks();
    });

    await runIfTool("delete_replay_session", async () => {
        assert(sessionId !== null, "no session for delete_replay_session");
        await callTool("delete_replay_session", { ids: [sessionId] });
    });

    await runIfTool("delete_replay_collection", async () => {
        assert(collectionId !== null, "no collection for delete_replay_collection");
        await callTool("delete_replay_collection", { items: [collectionId] });
    });
};
