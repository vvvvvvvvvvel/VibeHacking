import { Buffer } from "buffer";
import type { Socket } from "net";

import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Blob, Request as CaidoRequest, Response as CaidoResponse, Headers } from "caido:http";
import { MCP_PLUGIN_VERSION } from "shared";

import type { ConfirmActionStore } from "./confirm-actions";
import { registerMcpTools } from "./mcp-tools";
import type { HandlerResult, HttpHandler } from "./server";
import type { ToolPermissionsStore } from "./tool-permissions";
import type { MCPSDK } from "./types/sdk";

export class McpRuntime {
    private readonly sdk: MCPSDK;
    private readonly confirmStore: ConfirmActionStore;
    private readonly permissionsStore: ToolPermissionsStore;
    private toolsByAction: Map<string, RegisteredTool> = new Map();
    private server: McpServer | undefined;
    private activeSseSocket: Socket | undefined;
    private activeSseTransport: WebStandardStreamableHTTPServerTransport | undefined;
    private activeSseServer: McpServer | undefined;
    private activeSseToolsByAction: Map<string, RegisteredTool> | undefined;

    constructor(
        sdk: MCPSDK,
        confirmStore: ConfirmActionStore,
        permissionsStore: ToolPermissionsStore,
    ) {
        this.sdk = sdk;
        this.confirmStore = confirmStore;
        this.permissionsStore = permissionsStore;
    }

    private getServer() {
        if (!this.server) {
            this.server = new McpServer(
                {
                    name: "vibe-hacking-server",
                    version: MCP_PLUGIN_VERSION,
                },
                {
                    capabilities: {
                        tools: {},
                    },
                },
            );
            const registry = registerMcpTools(
                this.server,
                this.sdk,
                this.confirmStore,
                this.permissionsStore,
            );
            this.toolsByAction = registry.toolsByAction;
            this.applyToolPermissions();
        }
        return this.server;
    }

    initializeTools() {
        this.getServer();
    }

    applyToolPermissions() {
        this.applyToolPermissionsTo(this.toolsByAction);
        this.applyToolPermissionsTo(this.activeSseToolsByAction);
        this.server?.sendToolListChanged();
        this.activeSseServer?.sendToolListChanged();
    }

    private applyToolPermissionsTo(toolsByAction: Map<string, RegisteredTool> | undefined) {
        for (const [action, tool] of toolsByAction?.entries() ?? []) {
            const mode = this.permissionsStore.getModeForAction(action);
            if (mode === "disabled") {
                tool.disable();
            } else {
                tool.enable();
            }
        }
    }

    private createTransport() {
        return new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
    }

    private createRequestServer() {
        const server = new McpServer(
            {
                name: "vibe-hacking-server",
                version: MCP_PLUGIN_VERSION,
            },
            {
                capabilities: {
                    tools: {},
                },
            },
        );
        const registry = registerMcpTools(
            server,
            this.sdk,
            this.confirmStore,
            this.permissionsStore,
        );
        this.applyToolPermissionsTo(registry.toolsByAction);
        return { server, toolsByAction: registry.toolsByAction };
    }

    private async handleTransportRequest(
        transport: WebStandardStreamableHTTPServerTransport,
        req: CaidoRequest,
    ): Promise<CaidoResponse> {
        return (await transport.handleRequest(req as unknown as Request)) as CaidoResponse;
    }

    private ensureGlobals() {
        type GlobalShim = {
            Response?: unknown;
            Request?: unknown;
            Headers?: unknown;
            TextEncoder?: unknown;
            TextDecoder?: unknown;
        };
        const g = globalThis as unknown as GlobalShim;

        if (g.Response === undefined) g.Response = CaidoResponse;
        if (g.Request === undefined) g.Request = CaidoRequest;
        if (g.Headers === undefined) g.Headers = Headers;
        if (g.TextEncoder === undefined) {
            class SimpleTextEncoder {
                encode(input: string): Uint8Array<ArrayBuffer> {
                    return Buffer.from(input, "utf8") as unknown as Uint8Array<ArrayBuffer>;
                }
            }
            void SimpleTextEncoder.prototype.encode;
            g.TextEncoder = SimpleTextEncoder;
        }
        if (g.TextDecoder === undefined) {
            class SimpleTextDecoder {
                decode(input: Uint8Array): string {
                    return Buffer.from(input).toString("utf8");
                }
            }
            void SimpleTextDecoder.prototype.decode;
            g.TextDecoder = SimpleTextDecoder;
        }
    }

    createHandler(): HttpHandler {
        this.ensureGlobals();
        this.getServer();

        return async (req: CaidoRequest): Promise<CaidoResponse | HandlerResult> =>
            await this.handleHttpRequest(req);
    }

    private async handleHttpRequest(req: CaidoRequest): Promise<CaidoResponse | HandlerResult> {
        if (req.method !== "POST" && req.method !== "GET") {
            return new CaidoResponse(new Blob(["Method Not Allowed"]), {
                status: 405,
            });
        }
        if (req.method === "GET") {
            let mcpServer: McpServer | undefined;
            let toolsByAction: Map<string, RegisteredTool> | undefined;
            let mcpTransport: WebStandardStreamableHTTPServerTransport | undefined;
            try {
                await this.closeActiveSse();
                const requestServer = this.createRequestServer();
                mcpServer = requestServer.server;
                toolsByAction = requestServer.toolsByAction;
                mcpTransport = this.createTransport();
                await mcpServer.connect(mcpTransport);
                const response = await this.handleTransportRequest(mcpTransport, req);
                const contentType = response.headers.get("content-type") ?? "";
                const isSse = contentType.includes("text/event-stream");
                if (!isSse) {
                    await this.closeRequestResources(mcpServer, mcpTransport);
                    return response;
                }
                const sseServer = mcpServer;
                const sseTransport = mcpTransport;
                const sseToolsByAction = toolsByAction;
                return {
                    response,
                    keepOpen: true,
                    onSocket: (socket) => {
                        this.activeSseSocket = socket;
                        this.activeSseTransport = sseTransport;
                        this.activeSseServer = sseServer;
                        this.activeSseToolsByAction = sseToolsByAction;
                        socket.on("close", () => {
                            if (this.activeSseSocket === socket) {
                                this.activeSseSocket = undefined;
                            }
                            if (this.activeSseTransport === sseTransport) {
                                this.activeSseTransport = undefined;
                            }
                            if (this.activeSseServer === sseServer) {
                                this.activeSseServer = undefined;
                                this.activeSseToolsByAction = undefined;
                            }
                            sseTransport.closeStandaloneSSEStream();
                            (sseTransport as { close?: () => void }).close?.();
                            void sseServer.close();
                        });
                        socket.on("error", () => undefined);
                    },
                };
            } catch (err) {
                await this.closeRequestResources(mcpServer, mcpTransport);
                this.sdk.console.error(`MCP SSE handleRequest failed: ${err}`);
                return new CaidoResponse(new Blob(["Internal Server Error"]), {
                    status: 500,
                });
            }
        }
        let mcpServer: McpServer | undefined;
        let mcpTransport: WebStandardStreamableHTTPServerTransport | undefined;
        try {
            mcpServer = this.createRequestServer().server;
            mcpTransport = this.createTransport();
            await mcpServer.connect(mcpTransport);
            return await this.handleTransportRequest(mcpTransport, req);
        } catch (err) {
            this.sdk.console.error(`MCP handleRequest failed: ${err}`);
            return new CaidoResponse(new Blob(["Internal Server Error"]), {
                status: 500,
            });
        } finally {
            await this.closeRequestResources(mcpServer, mcpTransport);
        }
    }

    async stop() {
        await this.closeActiveSse();
    }

    private async closeActiveSse() {
        const socket = this.activeSseSocket;
        const transport = this.activeSseTransport;
        const server = this.activeSseServer;

        this.activeSseSocket = undefined;
        this.activeSseTransport = undefined;
        this.activeSseServer = undefined;
        this.activeSseToolsByAction = undefined;

        try {
            socket?.destroy();
        } catch {
            // Ignore socket close errors.
        }
        try {
            transport?.closeStandaloneSSEStream();
            (transport as { close?: () => void } | undefined)?.close?.();
        } catch {
            // Ignore transport close errors.
        }
        try {
            await server?.close();
        } catch {
            // Ignore MCP server close errors.
        }
    }

    private async closeRequestResources(
        server: McpServer | undefined,
        transport: WebStandardStreamableHTTPServerTransport | undefined,
    ) {
        try {
            transport?.closeStandaloneSSEStream();
            (transport as { close?: () => void } | undefined)?.close?.();
        } catch {
            // Ignore transport close errors.
        }
        try {
            await server?.close();
        } catch {
            // Ignore MCP server close errors.
        }
    }
}
