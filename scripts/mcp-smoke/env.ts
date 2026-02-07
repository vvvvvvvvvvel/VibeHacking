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

    await runIfTool("get-environment", async () => {
        await callTool("get-environment", { name: "PATH" });
    });

    await runIfTool("get-environment-variable", async () => {
        await callTool("get-environment-variable", {});
    });

    await runIfTool("set-environment", async () => {
        const name = `MCP_SMOKE_${Date.now()}`;
        await callTool("set-environment", { name, value: "1", secret: false });
        const res = await callTool("get-environment", { name });
        const text = getToolText(res);
        const parsed = tryParseJSON<{ name?: string; value?: string }>(text);
        if (parsed?.name) {
            assert(parsed.name === name, "env var not set");
            assert(parsed.value === "1", "env var value mismatch");
            return;
        }
        assert(text === "1", "env var not set");

        if (tools.has("list-environments") && tools.has("update-environment")) {
            const listRes = await callTool("list-environments", {});
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
                await callTool("update-environment", { id: globalEnv.id, variables: nextVars });
            }
        }
    });

    await runIfTool("list-environments", async () => {
        await callTool("list-environments", {});
    });

    const canCreate = tools.has("create-environment");
    const canUpdate = tools.has("update-environment");
    const canDelete = tools.has("delete-environment");
    const canList = tools.has("list-environments");

    if (canCreate && canUpdate && canDelete) {
        const envName = `MCP_SMOKE_ENV_${Date.now()}`;
        const varName = `MCP_SMOKE_VAR_${Date.now()}`;

        const createRes = await callTool("create-environment", {
            name: envName,
            variables: [{ name: varName, value: "1", kind: "PLAIN" }],
        });
        const createData = getGraphQLData(getToolText(createRes));
        const createdEnv = (createData as { createEnvironment?: { environment?: { id?: string } } })
            ?.createEnvironment?.environment;
        assert(createdEnv?.id, "env create failed");

        const updateRes = await callTool("update-environment", {
            id: createdEnv.id,
            variables: [{ name: varName, value: "2", kind: "PLAIN" }],
        });
        const updateData = getGraphQLData(getToolText(updateRes));
        const updatedVars = (
            updateData as {
                updateEnvironment?: {
                    environment?: { variables?: Array<{ name?: string; value?: string }> };
                };
            }
        )?.updateEnvironment?.environment?.variables;
        const updatedVar = updatedVars?.find((variable) => variable.name === varName);
        assert(updatedVar?.value === "2", "env var update failed");

        const deleteRes = await callTool("delete-environment", { id: createdEnv.id });
        const deleteData = getGraphQLData(getToolText(deleteRes));
        const deletedId = (deleteData as { deleteEnvironment?: { deletedId?: string } })
            ?.deleteEnvironment?.deletedId;
        assert(deletedId === createdEnv.id, "env delete failed");

        if (canList) {
            const listRes = await callTool("list-environments", {});
            const listData = getGraphQLData(getToolText(listRes));
            const envs =
                (listData as { environments?: Array<{ id?: string }> })?.environments ?? [];
            assert(!envs.some((env) => env.id === createdEnv.id), "env not deleted");
        }
    }

    await runIfTool("get-environment-context", async () => {
        await callTool("get-environment-context", {});
    });

    const canSelect = tools.has("select-environment");
    if (canCreate && canDelete && canSelect) {
        const envName = `MCP_SMOKE_SELECT_ENV_${Date.now()}`;
        const varName = `MCP_SMOKE_SELECT_VAR_${Date.now()}`;

        const baselineVarsRes = await callTool("get-environment-variable", {});
        const baselineVarsText = getToolText(baselineVarsRes);
        const baselineVars = tryParseJSON<Array<{ name?: string }>>(baselineVarsText) ?? [];
        assert(
            !baselineVars.some((variable) => variable.name === varName),
            "baseline already has test var",
        );

        const createRes = await callTool("create-environment", {
            name: envName,
            variables: [{ name: varName, value: "1", kind: "PLAIN" }],
        });
        const createData = getGraphQLData(getToolText(createRes));
        const createdEnv = (createData as { createEnvironment?: { environment?: { id?: string } } })
            ?.createEnvironment?.environment;
        assert(createdEnv?.id, "env create failed (select test)");

        const preSelectVarsRes = await callTool("get-environment-variable", {});
        const preSelectVarsText = getToolText(preSelectVarsRes);
        const preSelectVars = tryParseJSON<Array<{ name?: string }>>(preSelectVarsText) ?? [];
        assert(
            !preSelectVars.some((variable) => variable.name === varName),
            "selected env not isolated",
        );

        await callTool("select-environment", { id: createdEnv.id });
        const selectedVarsRes = await callTool("get-environment-variable", {});
        const selectedVarsText = getToolText(selectedVarsRes);
        const selectedVars = tryParseJSON<Array<{ name?: string }>>(selectedVarsText) ?? [];
        assert(
            selectedVars.some((variable) => variable.name === varName),
            "env select failed",
        );

        await callTool("select-environment", {});
        const clearedVarsRes = await callTool("get-environment-variable", {});
        const clearedVarsText = getToolText(clearedVarsRes);
        const clearedVars = tryParseJSON<Array<{ name?: string }>>(clearedVarsText) ?? [];
        assert(
            !clearedVars.some((variable) => variable.name === varName),
            "env select clear failed",
        );

        const deleteRes = await callTool("delete-environment", { id: createdEnv.id });
        const deleteData = getGraphQLData(getToolText(deleteRes));
        const deletedId = (deleteData as { deleteEnvironment?: { deletedId?: string } })
            ?.deleteEnvironment?.deletedId;
        assert(deletedId === createdEnv.id, "env delete failed (select test)");
    }

    if (tools.has("list-environments") && tools.has("update-environment")) {
        const listRes = await callTool("list-environments", {});
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
            await callTool("update-environment", {
                id: globalEnv.id,
                version: globalEnv.version,
                variables: nextVars,
            });
        }
    }
};
