import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

type AutomateSession = {
    id: string | number;
    entries?: Array<{ id: string | number }>;
};

export const runAutomate = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Automate");

    let session: AutomateSession | undefined;
    await runIfTool("list_automate_sessions", async () => {
        const result = await callTool("list_automate_sessions", { limit: 5 });
        const page = tryParseJSON<{
            page_info?: unknown;
            items?: AutomateSession[];
        }>(getToolText(result));
        assert(page?.page_info !== undefined, "Automate page_info missing");
        assert(Array.isArray(page?.items), "Automate items missing");
        session = page?.items?.[0];
    });

    if (session === undefined) return;

    await runIfTool("get_automate_session", async () => {
        const result = await callTool("get_automate_session", { id: session?.id });
        const item = tryParseJSON<AutomateSession>(getToolText(result));
        assert(String(item?.id) === String(session?.id), "Automate session ID mismatch");
        session = item ?? session;
    });

    const entryId = session.entries?.[0]?.id;
    if (entryId === undefined) return;

    await runIfTool("get_automate_entry", async () => {
        const result = await callTool("get_automate_entry", { id: entryId });
        const item = tryParseJSON<{ id?: string | number; requests?: { count?: number } }>(
            getToolText(result),
        );
        assert(String(item?.id) === String(entryId), "Automate entry ID mismatch");
        assert(typeof item?.requests?.count === "number", "Automate request count missing");
    });

    await runIfTool("list_automate_entry_requests", async () => {
        const result = await callTool("list_automate_entry_requests", {
            entry_id: entryId,
            limit: 5,
            fields: [
                "cursor",
                "sequence_id",
                "payloads",
                "extracts",
                "id",
                "request.method",
                "request.url",
                "response.status_code",
            ],
        });
        const page = tryParseJSON<{ page_info?: unknown; items?: unknown[] }>(getToolText(result));
        assert(page?.page_info !== undefined, "Automate request page_info missing");
        assert(Array.isArray(page?.items), "Automate request items missing");
    });
};
