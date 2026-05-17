import { assert, getToolText, logStep, makeToolCaller, tryParseJSON } from "./_utils";

const getGraphQLData = (text: string) => {
    const parsed = tryParseJSON<Record<string, unknown>>(text);
    if (!parsed) {
        return null;
    }
    return (parsed.data as Record<string, unknown> | undefined) ?? parsed;
};

export const runEnv = async (tools: Set<string>) => {
    const { callTool, runIfTool } = makeToolCaller(tools);

    logStep("Environment");

    await runIfTool("get_environment_variable", async () => {
        await callTool("get_environment_variable", { name: "PATH" });
    });

    await runIfTool("list_environment_variables", async () => {
        await callTool("list_environment_variables", {});
    });

    await runIfTool("set_environment_variable", async () => {
        const name = `MCP_SMOKE_${Date.now()}`;
        await callTool("set_environment_variable", { name, value: "1", secret: false });
        const res = await callTool("get_environment_variable", { name });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ name?: string; value?: string }>(text);
        if (parsed?.name) {
            assert(parsed.name === name, "env var not set");
            assert(parsed.value === "1", "env var value mismatch");
            return;
        }
        assert(text === "1", "env var not set");

        if (tools.has("list_environments") && tools.has("update_environment")) {
            const listRes = await callTool("list_environments", {});
            const listData = getGraphQLData(getToolText(listRes)) as {
                environments?: Array<{
                    id?: string;
                    name?: string;
                    variables?: Array<{ name?: string; value?: string; kind?: string }>;
                }>;
            };
            const globalEnv = listData?.environments?.find((env) => env.name === "Global");
            if (globalEnv?.id && globalEnv.variables) {
                const nextVars = globalEnv.variables
                    .filter((variable) => variable.name && variable.name !== name)
                    .map((variable) => ({
                        name: String(variable.name),
                        value: String(variable.value ?? ""),
                        kind: variable.kind === "SECRET" ? "SECRET" : "PLAIN",
                    }));
                await callTool("update_environment", { id: globalEnv.id, variables: nextVars });
            }
        }
    });

    await runIfTool("list_environments", async () => {
        await callTool("list_environments", {});
    });

    const canCreate = tools.has("create_environment");
    const canUpdate = tools.has("update_environment");
    const canDelete = tools.has("delete_environment");
    const canList = tools.has("list_environments");

    if (canCreate && canUpdate && canDelete) {
        const envName = `MCP_SMOKE_ENV_${Date.now()}`;
        const varName = `MCP_SMOKE_VAR_${Date.now()}`;

        const createRes = await callTool("create_environment", {
            name: envName,
            variables: [{ name: varName, value: "1", kind: "PLAIN" }],
        });
        const createData = getGraphQLData(getToolText(createRes));
        const createdEnv = (
            createData as { create_environment?: { environment?: { id?: string } } }
        )?.create_environment?.environment;
        assert(createdEnv?.id !== undefined, "env create failed");

        await callTool("get_environment", { id: createdEnv.id });

        const updateRes = await callTool("update_environment", {
            id: createdEnv.id,
            variables: [{ name: varName, value: "2", kind: "PLAIN" }],
        });
        const updateData = getGraphQLData(getToolText(updateRes));
        const updatedVars = (
            updateData as {
                update_environment?: {
                    environment?: { variables?: Array<{ name?: string; value?: string }> };
                };
            }
        )?.update_environment?.environment?.variables;
        const updatedVar = updatedVars?.find((variable) => variable.name === varName);
        assert(updatedVar?.value === "2", "env var update failed");

        const deleteRes = await callTool("delete_environment", { id: createdEnv.id });
        const deleteData = getGraphQLData(getToolText(deleteRes));
        const deleted_id = (deleteData as { delete_environment?: { deleted_id?: string } })
            ?.delete_environment?.deleted_id;
        assert(deleted_id === createdEnv.id, "env delete failed");

        if (canList) {
            const listRes = await callTool("list_environments", {});
            const listData = getGraphQLData(getToolText(listRes));
            const envs =
                (listData as { environments?: Array<{ id?: string }> })?.environments ?? [];
            assert(!envs.some((env) => env.id === createdEnv.id), "env not deleted");
        }
    }

    await runIfTool("get_environment_context", async () => {
        await callTool("get_environment_context", {});
    });

    const canSelect = tools.has("select_environment");
    if (canCreate && canDelete && canSelect) {
        const envName = `MCP_SMOKE_SELECT_ENV_${Date.now()}`;
        const varName = `MCP_SMOKE_SELECT_VAR_${Date.now()}`;
        const contextRes = await callTool("get_environment_context", {});
        const contextData = getGraphQLData(getToolText(contextRes)) as {
            environment_context?: { selected?: { id?: string } | null };
        };
        const originalSelectedEnvId = contextData?.environment_context?.selected?.id;
        let createdSelectEnvId: string | undefined;

        try {
            const baselineVarsRes = await callTool("list_environment_variables", {});
            const baselineVarsText = getToolText(baselineVarsRes);
            const baselineVars = tryParseJSON<Array<{ name?: string }>>(baselineVarsText) ?? [];
            assert(
                !baselineVars.some((variable) => variable.name === varName),
                "baseline already has test var",
            );

            const createRes = await callTool("create_environment", {
                name: envName,
                variables: [{ name: varName, value: "1", kind: "PLAIN" }],
            });
            const createData = getGraphQLData(getToolText(createRes));
            const createdEnv = (
                createData as { create_environment?: { environment?: { id?: string } } }
            )?.create_environment?.environment;
            assert(createdEnv?.id !== undefined, "env create failed (select test)");
            createdSelectEnvId = createdEnv.id;

            const preSelectVarsRes = await callTool("list_environment_variables", {});
            const preSelectVarsText = getToolText(preSelectVarsRes);
            const preSelectVars = tryParseJSON<Array<{ name?: string }>>(preSelectVarsText) ?? [];
            assert(
                !preSelectVars.some((variable) => variable.name === varName),
                "selected env not isolated",
            );

            await callTool("select_environment", { id: createdEnv.id });
            const selectedVarsRes = await callTool("list_environment_variables", {});
            const selectedVarsText = getToolText(selectedVarsRes);
            const selectedVars = tryParseJSON<Array<{ name?: string }>>(selectedVarsText) ?? [];
            assert(
                selectedVars.some((variable) => variable.name === varName),
                "env select failed",
            );

            await callTool("select_environment", {});
            const clearedVarsRes = await callTool("list_environment_variables", {});
            const clearedVarsText = getToolText(clearedVarsRes);
            const clearedVars = tryParseJSON<Array<{ name?: string }>>(clearedVarsText) ?? [];
            assert(
                !clearedVars.some((variable) => variable.name === varName),
                "env select clear failed",
            );
        } finally {
            await callTool(
                "select_environment",
                originalSelectedEnvId !== undefined ? { id: originalSelectedEnvId } : {},
            );

            if (createdSelectEnvId !== undefined) {
                const deleteRes = await callTool("delete_environment", { id: createdSelectEnvId });
                const deleteData = getGraphQLData(getToolText(deleteRes));
                const deleted_id = (
                    deleteData as { delete_environment?: { deleted_id?: string } }
                )?.delete_environment?.deleted_id;
                assert(deleted_id === createdSelectEnvId, "env delete failed (select test)");
            }
        }
    }

    if (tools.has("list_environments") && tools.has("update_environment")) {
        const listRes = await callTool("list_environments", {});
        const listData = getGraphQLData(getToolText(listRes)) as {
            environments?: Array<{
                id?: string;
                name?: string;
                version?: number;
                variables?: Array<{ name?: string; value?: string; kind?: string }>;
            }>;
        };
        const globalEnv = listData?.environments?.find((env) => env.name === "Global");
        if (globalEnv?.id && globalEnv.variables) {
            const nextVars = globalEnv.variables
                .filter(
                    (variable) => variable.name && !String(variable.name).startsWith("MCP_SMOKE_"),
                )
                .map((variable) => ({
                    name: String(variable.name),
                    value: String(variable.value ?? ""),
                    kind: variable.kind === "SECRET" ? "SECRET" : "PLAIN",
                }));
            await callTool("update_environment", {
                id: globalEnv.id,
                version: globalEnv.version,
                variables: nextVars,
            });
        }
    }
};
