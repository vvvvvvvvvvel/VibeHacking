import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

export const runSitemap = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Sitemap");

    let rootId: string | number | null = null;

    await runIfTool("list_sitemap_roots", async () => {
        const res = await callTool("list_sitemap_roots", {
            limit: 5,
            fields: ["id", "label", "kind", "metadata", "requests.count"],
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{
            items?: Array<any>;
            matched?: number;
            returned?: number;
            has_more?: boolean;
            next_offset?: number;
        }>(text);
        assert(Array.isArray(parsed?.items), "list_sitemap_roots items missing");
        assert(typeof parsed?.matched === "number", "list_sitemap_roots matched missing");
        assert(typeof parsed?.returned === "number", "list_sitemap_roots returned missing");
        assert(typeof parsed?.has_more === "boolean", "list_sitemap_roots has_more missing");
        if (parsed.has_more) {
            assert(
                typeof parsed.next_offset === "number",
                "list_sitemap_roots next_offset missing",
            );
        }
        rootId = parsed?.items?.[0]?.id ?? null;
    });

    await runIfTool("get_sitemap_entries_by_ids", async () => {
        const ids = rootId === null ? ["0"] : [rootId];
        const res = await callTool("get_sitemap_entries_by_ids", {
            ids,
            request_limit: 1,
            fields: ["id", "label", "kind", "requests.count", "requests.items.id"],
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ requested?: number; results?: Array<any> }>(text);
        assert(parsed?.requested === 1, "get_sitemap_entries_by_ids requested mismatch");
        assert(Array.isArray(parsed?.results), "get_sitemap_entries_by_ids results missing");
    });

    await runIfTool("list_sitemap_roots", async () => {
        const res = await callTool("list_sitemap_roots", {
            limit: 1,
            request_limit: 1,
            fields: ["id", "requests.count", "requests.items.id", "requests.items.url"],
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ items?: Array<any> }>(text);
        const first = parsed?.items?.[0];
        assert(first !== undefined, "list_sitemap_roots request sample item missing");
        if ((first.requests?.count ?? 0) > 0) {
            assert(first.requests?.items?.length > 0, "list_sitemap_roots request sample missing");
            assert(
                first.requests.items[0]?.id !== undefined &&
                    first.requests.items[0]?.url !== undefined,
                "list_sitemap_roots should project multiple request item fields",
            );
        }
    });

    await runIfTool("list_sitemap_descendants", async () => {
        if (rootId === null) return;
        const res = await callTool("list_sitemap_descendants", {
            parent_id: rootId,
            depth: "DIRECT",
            limit: 10,
            fields: ["id", "label", "kind", "parent_id", "requests.count"],
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ items?: Array<any>; source_count?: number }>(text);
        assert(Array.isArray(parsed?.items), "list_sitemap_descendants items missing");
        assert(
            typeof parsed?.source_count === "number",
            "list_sitemap_descendants source_count missing",
        );
    });

    await runIfTool("list_sitemap_entry_requests", async () => {
        if (rootId === null) return;
        const res = await callTool("list_sitemap_entry_requests", {
            entry_id: rootId,
            limit: 3,
            fields: ["cursor", "id", "request.method", "request.url", "response.status_code"],
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ entry?: any; page_info?: any; items?: Array<any> }>(text);
        assert(parsed?.entry?.id !== undefined, "list_sitemap_entry_requests entry missing");
        assert(parsed?.page_info !== undefined, "list_sitemap_entry_requests page_info missing");
        assert(Array.isArray(parsed?.items), "list_sitemap_entry_requests items missing");
    });

    await runIfTool("list_sitemap_entry_requests", async () => {
        if (rootId === null) return;
        const res = await callTool("list_sitemap_entry_requests", {
            entry_id: rootId,
            limit: 1,
            serialization: {
                include_body: true,
                max_text_body_chars: 64,
                text_overflow_mode: "truncate",
            },
            fields: ["id", "request.body", "response.body"],
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ items?: Array<any> }>(text);
        assert(
            Array.isArray(parsed?.items),
            "list_sitemap_entry_requests serialized items missing",
        );
        if (parsed.items.length > 0) {
            assert(
                parsed.items[0]?.request?.body !== undefined ||
                    parsed.items[0]?.response?.body !== undefined,
                "list_sitemap_entry_requests body serialization missing",
            );
        }
    });

    await runIfTool("list_sitemap_entry_requests", async () => {
        if (rootId === null) return;
        const res = await callTool("list_sitemap_entry_requests", {
            entry_id: rootId,
            limit: 1,
            serialization: {
                regex_excerpt: { regex: "GET|POST", context_chars: 0 },
            },
            fields: ["id", "request.body", "response.raw", "match_context.excerpts"],
        });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ items?: Array<any> }>(text);
        assert(Array.isArray(parsed?.items), "list_sitemap_entry_requests regex items missing");
        if (parsed.items.length > 0) {
            assert(
                parsed.items[0]?.request === undefined,
                "list_sitemap_entry_requests should ignore conflicting request body fields",
            );
            assert(
                parsed.items[0]?.response === undefined,
                "list_sitemap_entry_requests should ignore conflicting response raw fields",
            );
            assert(
                parsed.items[0]?.match_context?.excerpts?.length > 0,
                "list_sitemap_entry_requests regex excerpts missing",
            );
        }
    });
};
