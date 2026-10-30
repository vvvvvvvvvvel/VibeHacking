import assert from "assert/strict";
import { mkdtemp, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { ConfirmActionStore } from "../packages/backend/src/confirm-actions";
import { executeGraphql } from "../packages/backend/src/graphql/execute";
import {
    buildMatchContext,
    compileRegex,
    MAX_REGEX_EXCERPTS,
} from "../packages/backend/src/history";
import { McpSettingsStore } from "../packages/backend/src/mcp-settings";
import {
    decodeRawHttpRequest,
    rawHttpRequestSchema,
} from "../packages/backend/src/mcp-tools/raw-request";
import { ciEnumDefault } from "../packages/backend/src/mcp-tools/shared";
import { ToolPermissionsStore } from "../packages/backend/src/tool-permissions";
import type { KVSDK, KVValue, MCPSDK } from "../packages/backend/src/types/sdk";

class MemoryKv implements KVSDK {
    readonly values = new Map<string, KVValue>();
    failSet = false;
    returnNullForMissing: boolean;
    setDelayMs = 0;

    constructor(returnNullForMissing = false) {
        this.returnNullForMissing = returnNullForMissing;
    }

    define() {
        return Promise.resolve();
    }

    get<T extends KVValue>(key: string) {
        if (this.values.has(key)) {
            return Promise.resolve(this.values.get(key) as T);
        }
        return Promise.resolve((this.returnNullForMissing ? null : undefined) as T | undefined);
    }

    async set<T extends KVValue>(key: string, value: T) {
        if (this.setDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.setDelayMs));
        }
        if (this.failSet) return Promise.reject(new Error("KV write failed"));
        this.values.set(key, value);
    }

    del(key: string) {
        this.values.delete(key);
        return Promise.resolve();
    }
}

const makeSdk = (path: string, kv = new MemoryKv()) =>
    ({
        kv,
        meta: { path: () => path },
        console: { error: () => undefined },
    }) as unknown as MCPSDK;

const assertCleared = async (path: string) => {
    assert.equal(await readFile(path, "utf8"), "{}\n");
};

const testSettingsMigration = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-settings-"));
    const legacyPath = join(directory, "settings.json");
    await writeFile(
        legacyPath,
        JSON.stringify({ enabled: true, host: "127.0.0.2", port: 4444, controlToken: "old" }),
    );
    const kv = new MemoryKv();
    const store = new McpSettingsStore(makeSdk(directory, kv));
    const snapshot = await store.load();

    assert.deepEqual(snapshot, {
        enabled: true,
        host: "127.0.0.2",
        port: 4444,
        confirmationTimeoutSeconds: 300,
    });
    assert.deepEqual(kv.values.get("mcp-server-settings"), snapshot);
    await assertCleared(legacyPath);
};

const testPermissionMigration = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-permissions-"));
    const legacyPath = join(directory, "tool-permissions.json");
    await writeFile(
        legacyPath,
        JSON.stringify({
            states: {
                "temper-safe": "disabled",
                "proxy-passthrough-safe": "disabled",
                "request-safe": "confirm",
            },
        }),
    );
    const kv = new MemoryKv();
    const store = new ToolPermissionsStore(makeSdk(directory, kv));
    await store.load();

    const permissions = store.getPermissions();
    assert.equal(permissions.states["tamper-safe"], "disabled");
    assert.equal(permissions.states["request-safe"], "confirm");
    assert.equal(permissions.states["automate-safe"], "disabled");
    assert.equal(permissions.states["proxy-traffic-control-safe"], "disabled");
    assert.equal("temper-safe" in permissions.states, false);
    assert.equal("proxy-passthrough-safe" in permissions.states, false);
    await assertCleared(legacyPath);

    const stored = kv.values.get("mcp-tool-permissions");
    assert.equal(JSON.stringify(stored).includes("temper-safe"), false);
    assert.equal(JSON.stringify(stored).includes("proxy-passthrough-safe"), false);
};

const testPersistenceFailuresPropagate = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-failure-"));
    const kv = new MemoryKv();
    const store = new McpSettingsStore(makeSdk(directory, kv));
    kv.failSet = true;
    await assert.rejects(store.save(), /KV write failed/);

    const permissionKv = new MemoryKv();
    const permissions = new ToolPermissionsStore(makeSdk(directory, permissionKv));
    await permissions.load();
    const previous = permissions.getPermissions().states["request-safe"];
    permissionKv.failSet = true;
    await assert.rejects(permissions.setGroupMode("request-safe", "disabled"), /KV write failed/);
    assert.equal(permissions.getPermissions().states["request-safe"], previous);
};

const testPermissionMutationsAreSerialized = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-permission-order-"));
    const kv = new MemoryKv();
    const permissions = new ToolPermissionsStore(makeSdk(directory, kv));
    await permissions.load();
    kv.setDelayMs = 5;

    const first = permissions.setGroupMode("request-safe", "disabled");
    const second = permissions.setGroupMode("request-safe", "auto");
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assert.equal(firstResult.states["request-safe"], "disabled");
    assert.equal(secondResult.states["request-safe"], "auto");
    assert.equal(permissions.getPermissions().states["request-safe"], "auto");
};

const testPermissionSnapshotsAreIsolated = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-permission-snapshot-"));
    const permissions = new ToolPermissionsStore(makeSdk(directory));
    await permissions.load();

    const snapshot = permissions.getPermissions();
    snapshot.states["request-safe"] = "disabled";
    snapshot.groups[0]?.tools.push({ action: "mutated", name: "mutated" });

    const current = permissions.getPermissions();
    assert.equal(current.states["request-safe"], "auto");
    assert.equal(
        current.groups[0]?.tools.some((tool) => tool.action === "mutated"),
        false,
    );
};

const testPermissionProfiles = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-permission-profiles-"));
    const permissions = new ToolPermissionsStore(makeSdk(directory));
    await permissions.load();

    const core = permissions.getPermissions();
    assert.equal(core.profile, "core");
    assert.deepEqual(core.states, {
        "group-log": "disabled",
        "env-safe": "disabled",
        "env-unsafe": "disabled",
        "filter-safe": "disabled",
        "filter-unsafe": "disabled",
        "finding-safe": "disabled",
        "finding-unsafe": "disabled",
        "hosted-file-safe": "disabled",
        "hosted-file-unsafe": "disabled",
        "proxy-traffic-control-safe": "disabled",
        "proxy-traffic-control-unsafe": "disabled",
        "automate-safe": "disabled",
        "project-safe": "disabled",
        "replay-read": "auto",
        "replay-prepare": "auto",
        "replay-execute": "confirm",
        "replay-manage": "disabled",
        "request-safe": "auto",
        "request-unsafe": "confirm",
        "runtime-safe": "disabled",
        "sitemap-safe": "auto",
        "scope-safe": "auto",
        "scope-unsafe": "disabled",
        "tamper-safe": "disabled",
        "tamper-unsafe": "disabled",
        "ws-safe": "auto",
    });

    const full = await permissions.applyProfile("full");
    assert.equal(full.profile, "full");
    for (const group of full.groups) {
        const expected =
            group.id === "group-log"
                ? "disabled"
                : group.id.endsWith("-unsafe") ||
                    group.id === "replay-execute" ||
                    group.id === "replay-manage"
                  ? "confirm"
                  : "auto";
        assert.equal(full.states[group.id], expected, `unexpected Full mode for ${group.id}`);
    }

    const custom = await permissions.setGroupMode("env-safe", "disabled");
    assert.equal(custom.profile, "custom");
};

const testConfirmationTimeoutSettings = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-confirmation-settings-"));
    const kv = new MemoryKv();
    const settings = new McpSettingsStore(makeSdk(directory, kv));
    await settings.load();

    settings.setToolConfirmationTimeout(600);
    await settings.save();
    assert.equal(settings.getSnapshot().confirmationTimeoutSeconds, 600);
    assert.equal(
        (kv.values.get("mcp-server-settings") as { confirmationTimeoutSeconds?: number })
            .confirmationTimeoutSeconds,
        600,
    );
    assert.throws(() => settings.setToolConfirmationTimeout(4), /between 5 and 3600/);
    assert.throws(() => settings.setToolConfirmationTimeout(3601), /between 5 and 3600/);
};

const testConfirmationTimeout = async () => {
    const store = new ConfirmActionStore(() => 10);
    const pending = store.createPendingAction("test.action", { value: 1 }, () =>
        Promise.resolve("ok"),
    );
    const result = await pending.promise;

    assert.equal(result.confirmed, false);
    assert.match(result.error ?? "", /timed out/);
    assert.equal(await store.resolveToolActionConfirmation(pending.id, true), null);
};

const testConfirmationResolutionClearsTimeout = async () => {
    const store = new ConfirmActionStore(() => 1000);
    const pending = store.createPendingAction("test.action", {}, () => Promise.resolve("ok"));
    const resolved = await store.resolveToolActionConfirmation(pending.id, true);
    const result = await pending.promise;

    assert.equal(resolved?.result, "ok");
    assert.equal(result.confirmed, true);
    assert.equal(result.error, undefined);
};

const testGraphqlErrorsPropagate = async () => {
    const sdk = {
        graphql: {
            execute: () => Promise.resolve({ errors: [{ message: "not allowed" }] }),
        },
    } as unknown as Pick<MCPSDK, "graphql">;
    await assert.rejects(
        executeGraphql(sdk, "query sample { viewer }"),
        /GraphQL sample failed: not allowed/,
    );
};

const testGraphqlVariablesDefaultToObject = async () => {
    let receivedVariables: unknown;
    const sdk = {
        graphql: {
            execute: (_document: string, variables: unknown) => {
                receivedVariables = variables;
                return Promise.resolve({ data: { ok: true } });
            },
        },
    } as unknown as Pick<MCPSDK, "graphql">;

    await executeGraphql(sdk, "query sample { viewer }");
    assert.deepEqual(receivedVariables, {});
};

const testRawHttpRequestInput = () => {
    const rawText = "GET / HTTP/1.1\r\nHost: example.com\r\n\r\n";
    const fromText = rawHttpRequestSchema.parse({
        raw_text: rawText,
        host: "example.com",
        port: 443,
    });
    assert.equal(decodeRawHttpRequest(fromText).toString("utf8"), rawText);

    const fromBase64 = rawHttpRequestSchema.parse({
        raw_base64: Buffer.from(rawText).toString("base64"),
        host: "example.com",
        port: 443,
    });
    assert.equal(decodeRawHttpRequest(fromBase64).toString("utf8"), rawText);

    assert.equal(rawHttpRequestSchema.safeParse({ host: "example.com", port: 443 }).success, false);
    assert.equal(
        rawHttpRequestSchema.safeParse({
            raw_text: rawText,
            raw_base64: Buffer.from(rawText).toString("base64"),
            host: "example.com",
            port: 443,
        }).success,
        false,
    );
};

const testRegexExcerptGuardrails = () => {
    assert.throws(() => compileRegex("x".repeat(4097), "regex"), /at most 4096/);
    const context = buildMatchContext(
        [{ path: "response.body.text", text: "x".repeat(MAX_REGEX_EXCERPTS + 1) }],
        { pattern: /x/, contextChars: 0 },
    );
    assert.equal(context?.excerpts.length, MAX_REGEX_EXCERPTS);
    assert.equal(context?.truncated, true);
};

const testCaseInsensitiveEnumPublishesDefault = () => {
    const metadata = ciEnumDefault(["after", "before"], "after").meta();
    assert.equal(metadata?.default, "after");
};

const testKvWinsAfterMigration = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-kv-first-"));
    const legacyPath = join(directory, "settings.json");
    await writeFile(legacyPath, JSON.stringify({ enabled: false, host: "legacy", port: 1111 }));
    const kv = new MemoryKv();
    kv.values.set("mcp-server-settings", {
        enabled: true,
        host: "kv",
        port: 2222,
    });
    const store = new McpSettingsStore(makeSdk(directory, kv));
    assert.deepEqual(await store.load(), {
        enabled: true,
        host: "kv",
        port: 2222,
        confirmationTimeoutSeconds: 300,
    });
    await assertCleared(legacyPath);
};

const testNullKvValueIsTreatedAsMissing = async () => {
    const directory = await mkdtemp(join(tmpdir(), "caido-mcp-null-kv-"));
    const settingsKv = new MemoryKv(true);
    const settings = new McpSettingsStore(makeSdk(directory, settingsKv));
    assert.equal(await settings.load(), undefined);
    assert.deepEqual(settingsKv.values.get("mcp-server-settings"), {
        enabled: false,
        host: "127.0.0.1",
        port: 3333,
        confirmationTimeoutSeconds: 300,
    });

    const permissionsKv = new MemoryKv(true);
    const permissions = new ToolPermissionsStore(makeSdk(directory, permissionsKv));
    await permissions.load();
    assert.equal(permissions.getPermissions().states["request-safe"], "auto");
    assert.ok(permissionsKv.values.has("mcp-tool-permissions"));
};

const main = async () => {
    await testSettingsMigration();
    await testPermissionMigration();
    await testPersistenceFailuresPropagate();
    await testPermissionMutationsAreSerialized();
    await testPermissionSnapshotsAreIsolated();
    await testPermissionProfiles();
    await testConfirmationTimeoutSettings();
    await testConfirmationTimeout();
    await testConfirmationResolutionClearsTimeout();
    await testGraphqlErrorsPropagate();
    await testGraphqlVariablesDefaultToObject();
    testRawHttpRequestInput();
    testRegexExcerptGuardrails();
    testCaseInsensitiveEnumPublishesDefault();
    await testKvWinsAfterMigration();
    await testNullKvValueIsTreatedAsMissing();
};

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
