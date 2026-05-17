import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runTamper = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Tamper");

    await runIfTool("create_tamper_rule_collection", async () => {
        const nameA = `smoke-${Date.now()}`;
        const nameB = `smoke-${Date.now()}-b`;
        await callTool("create_tamper_rule_collection", { items: [nameA, nameB] });

        const listRes = await callTool("list_tamper_rule_collections", {});
        const listText = getToolText(listRes);
        const listJson = tryParseJSON<{
            data?: { tamper_rule_collections?: { nodes?: Array<any> } };
            tamper_rule_collections?: Array<any>;
        }>(listText);
        const nodes =
            listJson?.data?.tamper_rule_collections?.nodes ?? listJson?.tamper_rule_collections ?? [];
        const collectionA = nodes.find((n) => n?.name === nameA);
        const collectionB = nodes.find((n) => n?.name === nameB);
        assert(collectionA?.id, "tamper collection A not found after create");
        assert(collectionB?.id, "tamper collection B not found after create");

        await runIfTool("get_tamper_rule_collection", async () => {
            await callTool("get_tamper_rule_collection", { ids: [Number(collectionA.id)] });
        });

        await runIfTool("rename_tamper_rule_collection", async () => {
            await callTool("rename_tamper_rule_collection", {
                items: [{ id: Number(collectionA.id), name: `${nameA}-renamed` }],
            });
        });

        const ruleBase = {
            collection_id: Number(collectionA.id),
            target: "request",
            part: "header",
            operation: "add",
            matcher: { type: "name", value: "X-Smoke" },
            replacer: { type: "term", value: "1" },
            sources: ["INTERCEPT"],
        };

        let ruleId1: number | null = null;
        let ruleId2: number | null = null;

        await runIfTool("create_tamper_rule", async () => {
            const res = await callTool("create_tamper_rule", {
                items: [
                    { name: "smoke-1", ...ruleBase },
                    { name: "smoke-2", ...ruleBase },
                ],
            });
            const text = getToolText(res);
            const parsed =
                tryParseJSON<
                    Array<{ result?: { create_tamper_rule?: { rule?: { id?: number | string } } } }>
                >(text);
            ruleId1 =
                parsed?.[0]?.result?.create_tamper_rule?.rule?.id != null
                    ? Number(parsed[0].result.create_tamper_rule.rule.id)
                    : null;
            ruleId2 =
                parsed?.[1]?.result?.create_tamper_rule?.rule?.id != null
                    ? Number(parsed[1].result.create_tamper_rule.rule.id)
                    : null;
            assert(ruleId1 !== null && ruleId2 !== null, "tamper rule ids missing");
        });

        if (ruleId1 && ruleId2) {
            await runIfTool("list_tamper_rules", async () => {
                await callTool("list_tamper_rules", {});
            });

            await runIfTool("get_tamper_rule", async () => {
                await callTool("get_tamper_rule", { ids: [ruleId1] });
            });

            await runIfTool("update_tamper_rule", async () => {
                await callTool("update_tamper_rule", {
                    items: [
                        {
                            id: ruleId1,
                            name: "smoke-1-updated",
                            target: "request",
                            part: "header",
                            operation: "update",
                            matcher: { type: "name", value: "X-Smoke" },
                            replacer: { type: "term", value: "2" },
                            sources: ["INTERCEPT"],
                        },
                    ],
                });
            });

            await runIfTool("rename_tamper_rule", async () => {
                await callTool("rename_tamper_rule", {
                    items: [{ id: ruleId1, name: "smoke-1-r" }],
                });
            });

            await runIfTool("toggle_tamper_rule", async () => {
                await callTool("toggle_tamper_rule", {
                    rule_ids: [ruleId1],
                    enabled: true,
                });
            });

            await runIfTool("rank_tamper_rule", async () => {
                await callTool("rank_tamper_rule", {
                    id: ruleId2,
                    input: { before_id: ruleId1 },
                });
            });

            await runIfTool("move_tamper_rule", async () => {
                await callTool("move_tamper_rule", {
                    rule_ids: [ruleId1],
                    collection_id: Number(collectionB.id),
                });
            });

            await runIfTool("test_tamper_rule", async () => {
                const raw = "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n";
                const rawBase64 = Buffer.from(raw).toString("base64");
                await callTool("test_tamper_rule", {
                    raw_base64: rawBase64,
                    target: "request",
                    part: "header",
                    operation: "add",
                    matcher: { type: "name", value: "X-Smoke" },
                    replacer: { type: "term", value: "1" },
                });
            });

            await runIfTool("export_tamper", async () => {
                await callTool("export_tamper", { collections: [Number(collectionA.id)] });
            });

            await runIfTool("delete_tamper_rule", async () => {
                await callTool("delete_tamper_rule", {
                    rule_ids: [ruleId1, ruleId2],
                });
            });
        }

        await runIfTool("delete_tamper_rule_collection", async () => {
            await callTool("delete_tamper_rule_collection", {
                ids: [Number(collectionA.id), Number(collectionB.id)],
            });
        });
    });
};
