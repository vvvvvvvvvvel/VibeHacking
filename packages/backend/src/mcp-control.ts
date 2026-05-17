import { Buffer } from "buffer";

import { Blob, Response } from "caido:http";
import type { McpConfigInput, McpSettings, ToolGroupMode, ToolPermissions } from "shared";
import { z } from "zod";

import type { HttpHandler } from "./server";

type ControlOperations = {
    getMcpServerSettings: () => McpSettings;
    setMcpServerEnabled: (enabled: boolean) => Promise<McpSettings>;
    updateMcpServerConfig: (config: McpConfigInput) => Promise<McpSettings>;
    getToolGroupPermissionModes: () => ToolPermissions;
    setToolGroupPermissionMode: (groupId: string, mode: ToolGroupMode) => Promise<ToolPermissions>;
    setAllToolGroupPermissionModes: (mode: ToolGroupMode) => Promise<ToolPermissions>;
};

const controlRequestSchema = z
    .object({
        method: z.enum([
            "getMcpServerSettings",
            "setMcpServerEnabled",
            "updateMcpServerConfig",
            "getToolGroupPermissionModes",
            "setToolGroupPermissionMode",
            "setAllToolGroupPermissionModes",
        ]),
        params: z.unknown().optional(),
    })
    .strict();

const emptyParamsSchema = z.object({}).strict();
const setMcpServerEnabledParamsSchema = z.object({ enabled: z.boolean() }).strict();
const updateMcpServerConfigParamsSchema = z
    .object({
        host: z.string().trim().min(1),
        port: z.number().int().min(1).max(65535),
    })
    .strict();
const toolGroupModeSchema = z.union([
    z.literal("auto"),
    z.literal("confirm"),
    z.literal("disabled"),
]);
const setToolGroupPermissionModeParamsSchema = z
    .object({
        groupId: z.string().trim().min(1),
        mode: toolGroupModeSchema,
    })
    .strict();
const setAllToolGroupPermissionModesParamsSchema = z.object({ mode: toolGroupModeSchema }).strict();

const jsonResponse = (body: unknown, status = 200) =>
    new Response(new Blob([JSON.stringify(body)]), {
        status,
        headers: {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
        },
    });

const errorResponse = (status: number, code: string, message: string) =>
    jsonResponse(
        {
            ok: false,
            error: { code, message },
        },
        status,
    );

const normalizeParams = (params: unknown) => (params === undefined ? {} : params);

const isLoopbackIpv4 = (address: string) => /^127(?:\.\d{1,3}){3}$/.test(address);

const isLoopbackAddress = (address: string | undefined): boolean => {
    if (address === undefined || address === "") return false;
    const normalized = address.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
    if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
        return true;
    }
    if (isLoopbackIpv4(normalized)) return true;
    if (normalized.startsWith("::ffff:")) {
        return isLoopbackIpv4(normalized.slice("::ffff:".length));
    }
    return false;
};

export function createMcpControlHandler(operations: ControlOperations): HttpHandler {
    return async (request, context) => {
        if (!isLoopbackAddress(context.remoteAddress)) {
            return errorResponse(403, "forbidden", "API control is only available from localhost.");
        }

        if (request.method !== "POST") {
            return errorResponse(405, "method_not_allowed", "Use POST for API control.");
        }

        let payload: z.infer<typeof controlRequestSchema>;
        try {
            const raw = Buffer.from(await request.arrayBuffer()).toString("utf8");
            payload = controlRequestSchema.parse(raw === "" ? {} : JSON.parse(raw));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResponse(400, "bad_request", `Invalid control request: ${message}`);
        }

        try {
            switch (payload.method) {
                case "getMcpServerSettings": {
                    emptyParamsSchema.parse(normalizeParams(payload.params));
                    return jsonResponse({ ok: true, result: operations.getMcpServerSettings() });
                }
                case "setMcpServerEnabled": {
                    const params = setMcpServerEnabledParamsSchema.parse(
                        normalizeParams(payload.params),
                    );
                    const result = await operations.setMcpServerEnabled(params.enabled);
                    return jsonResponse({ ok: true, result });
                }
                case "updateMcpServerConfig": {
                    const params = updateMcpServerConfigParamsSchema.parse(
                        normalizeParams(payload.params),
                    );
                    const result = await operations.updateMcpServerConfig(params);
                    return jsonResponse({ ok: true, result });
                }
                case "getToolGroupPermissionModes": {
                    emptyParamsSchema.parse(normalizeParams(payload.params));
                    return jsonResponse({
                        ok: true,
                        result: operations.getToolGroupPermissionModes(),
                    });
                }
                case "setToolGroupPermissionMode": {
                    const params = setToolGroupPermissionModeParamsSchema.parse(
                        normalizeParams(payload.params),
                    );
                    const result = await operations.setToolGroupPermissionMode(
                        params.groupId,
                        params.mode,
                    );
                    return jsonResponse({ ok: true, result });
                }
                case "setAllToolGroupPermissionModes": {
                    const params = setAllToolGroupPermissionModesParamsSchema.parse(
                        normalizeParams(payload.params),
                    );
                    const result = await operations.setAllToolGroupPermissionModes(params.mode);
                    return jsonResponse({ ok: true, result });
                }
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResponse(400, "operation_failed", message);
        }
    };
}
