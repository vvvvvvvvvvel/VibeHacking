import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

const assertBodyOmitted = (label: string, payload: any) => {
    if (!payload) return;
    assert(payload.body === null, `${label} body should be null`);
    assert(payload.raw === null, `${label} raw should be null`);
    assert(payload.bodyEncoding === "omitted", `${label} bodyEncoding should be omitted`);
};

const assertBodyIncluded = (label: string, payload: any) => {
    if (!payload) return;
    assert(payload.raw !== null, `${label} raw should be present`);
};

const pickFirstRequestId = async (
    callTool: (n: string, a: Record<string, unknown>) => Promise<unknown>,
) => {
    const res = await callTool("query-requests", { limit: 1 });
    const text = getToolText(res);
    const parsed = tryParseJSON<{ items?: Array<any> }>(text);
    const first = parsed?.items?.[0]?.request?.id ?? parsed?.items?.[0]?.requestId ?? null;
    return first ? String(first) : null;
};

export const runReplay = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Replay");

    let requestId: string | null = null;
    let requestIdNum: number | null = null;
    if (tools.has("query-requests")) {
        requestId = await pickFirstRequestId(callTool);
        requestIdNum = requestId ? Number(requestId) : null;
        assert(requestId !== null, "no saved requests found for replay");
    }

    let collectionId: number | null = null;
    let sessionId: number | null = null;
    let entryId: number | null = null;
    let missingRequestEntryId: number | null = null;

    await runIfTool("create-replay-collection", async () => {
        const name = `smoke-${Date.now()}`;
        const res = await callTool("create-replay-collection", { names: [name] });
        const text = getToolText(res);
        const parsed = tryParseJSON<Array<{ id?: string }>>(text);
        collectionId = parsed?.[0]?.id != null ? Number(parsed[0].id) : null;
        assert(collectionId, "replay collection id missing");
    });

    await runIfTool("query-replay-collections", async () => {
        await callTool("query-replay-collections", { first: 5 });
    });

    await runIfTool("list-replay-collections-detailed", async () => {
        const res = await callTool("list-replay-collections-detailed", {
            first: 1,
            includeRequest: true,
            onlyLatestEntryDetails: true,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{
            replaySessionCollections?: { nodes?: Array<any> };
            data?: { replaySessionCollections?: { nodes?: Array<any> } };
        }>(text);
        const nodes =
            parsed?.replaySessionCollections?.nodes ??
            parsed?.data?.replaySessionCollections?.nodes ??
            [];
        for (const collection of nodes) {
            for (const session of collection.sessions ?? []) {
                const entries = session.entries?.nodes ?? [];
                const found = entries.find((entry: any) => entry?.id)?.id;
                const detailsEntry = entries.find((entry: any) => entry?.requestDetails);
                if (detailsEntry?.requestDetails) {
                    assertBodyOmitted(
                        "list-replay-collections-detailed requestDetails (default)",
                        detailsEntry.requestDetails,
                    );
                }
                if (detailsEntry?.responseDetails) {
                    assertBodyOmitted(
                        "list-replay-collections-detailed responseDetails (default)",
                        detailsEntry.responseDetails,
                    );
                }
                const missingRequestEntry = entries.find(
                    (entry: any) =>
                        entry &&
                        !entry.request &&
                        (entry.raw || entry.requestRawBase64 || entry.requestRawUtf8),
                );
                if (missingRequestEntry) {
                    missingRequestEntryId = Number(missingRequestEntry.id);
                    assert(
                        typeof missingRequestEntry.requestRawBase64 === "string",
                        "list-replay-collections-detailed should include requestRawBase64 when request missing",
                    );
                }
                if (found) {
                    entryId = Number(found);
                    return;
                }
            }
        }
    });

    await runIfTool("query-replay-sessions", async () => {
        const res = await callTool("query-replay-sessions", { first: 5 });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ replaySessions?: { nodes?: Array<any> } }>(text);
        const first = parsed?.replaySessions?.nodes?.[0]?.id ?? null;
        sessionId = first != null ? Number(first) : sessionId;
    });

    await runIfTool("create-replay-session", async () => {
        assert(requestId !== null, "no request for create-replay-session");
        assert(requestIdNum !== null, "no numeric request for create-replay-session");
        const res = await callTool("create-replay-session", {
            requestIds: [requestIdNum],
            collectionId: collectionId ?? undefined,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<Array<{ id?: string }>>(text);
        const created = parsed?.[0]?.id;
        if (created != null) {
            sessionId = Number(created);
        }
    });

    await runIfTool("send-to-replay", async () => {
        assert(requestId !== null, "no request for send-to-replay");
        assert(requestIdNum !== null, "no numeric request for send-to-replay");
        await callTool("send-to-replay", {
            requestIds: [requestIdNum],
            collectionId: collectionId ?? undefined,
            sessionName: "smoke",
        });
    });

    await runIfTool("send-to-replay-from-filter", async () => {
        await callTool("send-to-replay-from-filter", {
            filter: 'req.method.eq:"GET"',
            limit: 1,
            collectionId: collectionId ?? undefined,
        });
    });

    await runIfTool("list-replay-collections-detailed", async () => {
        if (missingRequestEntryId) {
            return;
        }
        const res = await callTool("list-replay-collections-detailed", {
            first: 5,
            includeRequest: true,
            onlyLatestEntryDetails: false,
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{
            replaySessionCollections?: { nodes?: Array<any> };
            data?: { replaySessionCollections?: { nodes?: Array<any> } };
        }>(text);
        const nodes =
            parsed?.replaySessionCollections?.nodes ??
            parsed?.data?.replaySessionCollections?.nodes ??
            [];
        for (const collection of nodes) {
            for (const session of collection.sessions ?? []) {
                const entries = session.entries?.nodes ?? [];
                const missing = entries.find(
                    (entry: any) =>
                        entry &&
                        !entry.request &&
                        (entry.raw || entry.requestRawBase64 || entry.requestRawUtf8),
                );
                if (missing) {
                    missingRequestEntryId = Number(missing.id);
                    return;
                }
            }
        }
    });

    await runIfTool("get-replay-session", async () => {
        assert(sessionId !== null, "no session for get-replay-session");
        await callTool("get-replay-session", { sessionIds: [sessionId] });
    });

    const runGetReplayEntryChecks = async () => {
        if (entryId) {
            const res = await callTool("get-replay-entry", {
                entryIds: [entryId],
                includeRequest: true,
            });
            const text = getToolText(res);
            const parsed = tryParseJSON<any[]>(text);
            const first = parsed?.[0];
            const details = first?.requestDetails;
            const responseDetails = first?.responseDetails;
            if (details) {
                assertBodyIncluded("get-replay-entry requestDetails (default)", details);
            }
            if (responseDetails) {
                assertBodyIncluded("get-replay-entry responseDetails (default)", responseDetails);
            }

            const resNoBody = await callTool("get-replay-entry", {
                entryIds: [entryId],
                includeRequest: true,
                serialization: { includeBody: false },
            });
            const textNoBody = getToolText(resNoBody);
            const parsedNoBody = tryParseJSON<any[]>(textNoBody);
            const firstNoBody = parsedNoBody?.[0];
            const detailsNoBody = firstNoBody?.requestDetails;
            const responseNoBody = firstNoBody?.responseDetails;
            if (detailsNoBody) {
                assertBodyOmitted(
                    "get-replay-entry requestDetails (includeBody=false)",
                    detailsNoBody,
                );
            }
            if (responseNoBody) {
                assertBodyOmitted(
                    "get-replay-entry responseDetails (includeBody=false)",
                    responseNoBody,
                );
            }
        } else {
            assert(entryId !== null, "no entry for get-replay-entry request-details checks");
        }

        if (missingRequestEntryId) {
            const resMissing = await callTool("get-replay-entry", {
                entryIds: [missingRequestEntryId],
                includeRequest: true,
                includeRawWhenRequestMissing: true,
            });
            const textMissing = getToolText(resMissing);
            const parsedMissing = tryParseJSON<any[]>(textMissing);
            const firstMissing = parsedMissing?.[0];
            if (firstMissing?.replayEntry?.request === null) {
                assert(
                    typeof firstMissing?.requestRawBase64 === "string",
                    "get-replay-entry should include requestRawBase64 when request missing",
                );
            }
        }
    };

    await runIfTool("move-replay-session", async () => {
        assert(sessionId !== null, "no session for move-replay-session");
        assert(collectionId !== null, "no collection for move-replay-session");
        await callTool("move-replay-session", { items: [{ ids: [sessionId], collectionId }] });
    });

    await runIfTool("rename-replay-collection", async () => {
        assert(collectionId !== null, "no collection for rename-replay-collection");
        await callTool("rename-replay-collection", {
            items: [{ id: collectionId, name: `smoke-${Date.now()}-renamed` }],
        });
    });

    await runIfTool("rename-replay-session", async () => {
        assert(sessionId !== null, "no session for rename-replay-session");
        await callTool("rename-replay-session", {
            items: [{ id: sessionId, name: `smoke-${Date.now()}-renamed` }],
        });
    });

    await runIfTool("start-replay-task", async () => {
        assert(sessionId !== null, "no session for start-replay-task");
        const raw = "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n";
        const rawBase64 = Buffer.from(raw).toString("base64");
        const res = await callTool("start-replay-task", {
            items: [
                {
                    sessionId,
                    rawBase64,
                    connection: { host: "127.0.0.1", port: 80, isTLS: false },
                },
            ],
        });
        if (!entryId) {
            const text = getToolText(res);
            const parsed = tryParseJSON<Array<any>>(text);
            const createdEntryId = parsed?.[0]?.result?.startReplayTask?.task?.replayEntry?.id;
            if (createdEntryId != null) {
                entryId = Number(createdEntryId);
            }
        }
        await runGetReplayEntryChecks();
    });

    await runIfTool("delete-replay-session", async () => {
        assert(sessionId !== null, "no session for delete-replay-session");
        await callTool("delete-replay-session", { ids: [sessionId] });
    });

    await runIfTool("delete-replay-collection", async () => {
        assert(collectionId !== null, "no collection for delete-replay-collection");
        await callTool("delete-replay-collection", { items: [collectionId] });
    });
};
