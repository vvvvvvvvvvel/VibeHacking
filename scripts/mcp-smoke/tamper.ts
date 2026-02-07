import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runTamper = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Tamper");

    await runIfTool("create-tamper-rule-collection", async () => {
        const nameA = `smoke-${Date.now()}`;
        const nameB = `smoke-${Date.now()}-b`;
        await callTool("create-tamper-rule-collection", { items: [nameA, nameB] });

        const listRes = await callTool("list-tamper-rule-collections", {});
        const listText = getToolText(listRes);
        const listJson = tryParseJSON<{
            data?: { tamperRuleCollections?: { nodes?: Array<any> } };
            tamperRuleCollections?: Array<any>;
        }>(listText);
        const nodes =
            listJson?.data?.tamperRuleCollections?.nodes ?? listJson?.tamperRuleCollections ?? [];
        const collectionA = nodes.find((n) => n?.name === nameA);
        const collectionB = nodes.find((n) => n?.name === nameB);
        assert(collectionA?.id, "tamper collection A not found after create");
        assert(collectionB?.id, "tamper collection B not found after create");

        await runIfTool("get-tamper-rule-collection", async () => {
            await callTool("get-tamper-rule-collection", { ids: [Number(collectionA.id)] });
        });

        await runIfTool("rename-tamper-rule-collection", async () => {
            await callTool("rename-tamper-rule-collection", {
                items: [{ id: Number(collectionA.id), name: `${nameA}-renamed` }],
            });
        });

        const ruleBase = {
            collectionId: Number(collectionA.id),
            target: "request",
            part: "header",
            operation: "add",
            matcher: { type: "name", value: "X-Smoke" },
            replacer: { type: "term", value: "1" },
            sources: ["INTERCEPT"],
        };

        let ruleId1: number | null = null;
        let ruleId2: number | null = null;

        await runIfTool("create-tamper-rule", async () => {
            const res = await callTool("create-tamper-rule", {
                items: [
                    { name: "smoke-1", ...ruleBase },
                    { name: "smoke-2", ...ruleBase },
                ],
            });
            const text = getToolText(res);
            const parsed =
                tryParseJSON<
                    Array<{ result?: { createTamperRule?: { rule?: { id?: number | string } } } }>
                >(text);
            ruleId1 =
                parsed?.[0]?.result?.createTamperRule?.rule?.id != null
                    ? Number(parsed[0].result.createTamperRule.rule.id)
                    : null;
            ruleId2 =
                parsed?.[1]?.result?.createTamperRule?.rule?.id != null
                    ? Number(parsed[1].result.createTamperRule.rule.id)
                    : null;
            assert(ruleId1 && ruleId2, "tamper rule ids missing");
        });

        if (ruleId1 && ruleId2) {
            await runIfTool("list-tamper-rules", async () => {
                await callTool("list-tamper-rules", {});
            });

            await runIfTool("get-tamper-rule", async () => {
                await callTool("get-tamper-rule", { ids: [ruleId1] });
            });

            await runIfTool("update-tamper-rule", async () => {
                await callTool("update-tamper-rule", {
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

            await runIfTool("rename-tamper-rule", async () => {
                await callTool("rename-tamper-rule", {
                    items: [{ id: ruleId1, name: "smoke-1-r" }],
                });
            });

            await runIfTool("toggle-tamper-rule", async () => {
                await callTool("toggle-tamper-rule", {
                    ruleIds: [ruleId1],
                    enabled: true,
                });
            });

            await runIfTool("rank-tamper-rule", async () => {
                await callTool("rank-tamper-rule", {
                    id: ruleId2,
                    input: { beforeId: ruleId1 },
                });
            });

            await runIfTool("move-tamper-rule", async () => {
                await callTool("move-tamper-rule", {
                    ruleIds: [ruleId1],
                    collectionId: Number(collectionB.id),
                });
            });

            await runIfTool("test-tamper-rule", async () => {
                const raw = "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n";
                const rawBase64 = Buffer.from(raw).toString("base64");
                await callTool("test-tamper-rule", {
                    rawBase64,
                    target: "request",
                    part: "header",
                    operation: "add",
                    matcher: { type: "name", value: "X-Smoke" },
                    replacer: { type: "term", value: "1" },
                });
            });

            await runIfTool("export-tamper", async () => {
                await callTool("export-tamper", { collections: [Number(collectionA.id)] });
            });

            await runIfTool("delete-tamper-rule", async () => {
                await callTool("delete-tamper-rule", {
                    ruleIds: [ruleId1, ruleId2],
                });
            });
        }

        await runIfTool("delete-tamper-rule-collection", async () => {
            await callTool("delete-tamper-rule-collection", {
                ids: [Number(collectionA.id), Number(collectionB.id)],
            });
        });
    });
};
