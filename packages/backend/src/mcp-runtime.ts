import { Buffer } from "buffer";
import type { Socket } from "net";

import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Blob, Headers, Request as CaidoRequest, Response as CaidoResponse } from "caido:http";
import { MCP_PLUGIN_VERSION } from "shared";

import type { ConfirmActionStore } from "./confirm-actions";
import { registerMcpTools } from "./mcp-tools";
import type { HandlerResult } from "./server";
import { createHttpServer } from "./server";
import type { ToolPermissionsStore } from "./tool-permissions";
import type { MCPSDK } from "./types/sdk";

type RuntimeOptions = {
    host: string;
    port: number;
    endpointPath: string;
};

export class McpRuntime {
    private readonly sdk: MCPSDK;
    private readonly confirmStore: ConfirmActionStore;
    private readonly permissionsStore: ToolPermissionsStore;
    private toolsByAction: Map<string, RegisteredTool> = new Map();
    private server: McpServer | undefined;
    private httpServer: ReturnType<typeof createHttpServer> | undefined;
    private activeSseSocket: Socket | undefined;
    private activeSseTransport: WebStandardStreamableHTTPServerTransport | undefined;
    private activeSseServer: McpServer | undefined;
    private isStopping = false;
    private onUnexpectedStop: (() => void) | undefined;

    constructor(
        sdk: MCPSDK,
        confirmStore: ConfirmActionStore,
        permissionsStore: ToolPermissionsStore,
    ) {
        this.sdk = sdk;
        this.confirmStore = confirmStore;
        this.permissionsStore = permissionsStore;
    }

    setUnexpectedStopHandler(handler?: () => void) {
        this.onUnexpectedStop = handler;
    }

    /*noinspection JSUnusedGlobalSymbols*/
    isRunning(): boolean {
        return !!this.httpServer;
    }

    private getServer() {
        if (!this.server) {
            this.server = new McpServer(
                {
                    name: "caido-mcp-server",
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
        this.server?.sendToolListChanged();
    }

    private applyToolPermissionsTo(toolsByAction: Map<string, RegisteredTool>) {
        for (const [action, tool] of toolsByAction.entries()) {
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
                name: "caido-mcp-server",
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
        return server;
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

    async start({ host, port, endpointPath }: RuntimeOptions) {
        if (this.httpServer) {
            return;
        }

        this.ensureGlobals();

        this.getServer();

        const server = createHttpServer({
            host,
            port,
            listen: false,
            handler: async (req: CaidoRequest): Promise<CaidoResponse | HandlerResult> => {
                const urlStr = req.url;
                const pathStart =
                    urlStr.indexOf("://") >= 0
                        ? urlStr.indexOf("/", urlStr.indexOf("://") + 3)
                        : urlStr.indexOf("/");
                const path = pathStart >= 0 ? urlStr.slice(pathStart).split("?")[0] : "/";
                if (path !== endpointPath) {
                    return new CaidoResponse(new Blob(["Not Found"]), { status: 404 });
                }
                if (req.method !== "POST" && req.method !== "GET") {
                    return new CaidoResponse(new Blob(["Method Not Allowed"]), {
                        status: 405,
                    });
                }
                if (req.method === "GET") {
                    try {
                        if (this.activeSseSocket) {
                            this.activeSseSocket.destroy();
                            this.activeSseSocket = undefined;
                        }
                        if (this.activeSseTransport) {
                            this.activeSseTransport.closeStandaloneSSEStream();
                            this.activeSseTransport = undefined;
                        }
                        if (this.activeSseServer) {
                            await this.activeSseServer.close();
                            this.activeSseServer = undefined;
                        }
                        const mcpServer = this.createRequestServer();
                        const mcpTransport = this.createTransport();
                        await mcpServer.connect(mcpTransport);
                        const response = await this.handleTransportRequest(mcpTransport, req);
                        const contentType = response.headers.get("content-type") ?? "";
                        const isSse = contentType.includes("text/event-stream");
                        if (!isSse) {
                            await mcpServer.close();
                            (mcpTransport as { close?: () => void }).close?.();
                            return response;
                        }
                        return {
                            response,
                            keepOpen: true,
                            onSocket: (socket) => {
                                this.activeSseSocket = socket;
                                this.activeSseTransport = mcpTransport;
                                this.activeSseServer = mcpServer;
                                socket.on("close", () => {
                                    if (this.activeSseSocket === socket) {
                                        this.activeSseSocket = undefined;
                                    }
                                    if (this.activeSseTransport === mcpTransport) {
                                        this.activeSseTransport = undefined;
                                    }
                                    if (this.activeSseServer === mcpServer) {
                                        this.activeSseServer = undefined;
                                    }
                                    mcpTransport.closeStandaloneSSEStream();
                                    (mcpTransport as { close?: () => void }).close?.();
                                    void mcpServer.close();
                                });
                                socket.on("error", () => undefined);
                            },
                        };
                    } catch (err) {
                        this.sdk.console.error(`MCP SSE handleRequest failed: ${err}`);
                        return new CaidoResponse(new Blob(["Internal Server Error"]), {
                            status: 500,
                        });
                    }
                }
                try {
                    const mcpServer = this.createRequestServer();
                    const mcpTransport = this.createTransport();
                    await mcpServer.connect(mcpTransport);
                    const response = await this.handleTransportRequest(mcpTransport, req);
                    await mcpServer.close();
                    (mcpTransport as { close?: () => void }).close?.();
                    return response;
                } catch (err) {
                    this.sdk.console.error(`MCP handleRequest failed: ${err}`);
                    return new CaidoResponse(new Blob(["Internal Server Error"]), {
                        status: 500,
                    });
                }
            },
        });

        server.on("error", (err: Error) => {
            this.sdk.console.error(`MCP HTTP server error: ${err}`);
            if (this.httpServer === server) {
                this.httpServer = undefined;
                if (!this.isStopping) {
                    this.onUnexpectedStop?.();
                }
            }
        });
        server.on("close", () => {
            if (this.httpServer === server) {
                this.httpServer = undefined;
                if (!this.isStopping) {
                    this.onUnexpectedStop?.();
                }
            }
        });

        try {
            await this.listenServer(server, host, port);
            this.httpServer = server;
        } catch (err) {
            try {
                server.close();
            } catch {
                // Ignore close errors.
            }
            throw err;
        }
    }

    async stop() {
        if (!this.httpServer) return;

        this.isStopping = true;
        const server = this.httpServer;

        await new Promise<void>((resolve) => {
            let done = false;
            let timer: ReturnType<typeof setTimeout> | undefined;

            const cleanup = () => {
                try {
                    server.off?.("close", onClose);
                } catch {
                    // Ignore cleanup errors.
                }
                try {
                    server.off?.("error", onError);
                } catch {
                    // Ignore cleanup errors.
                }
                if (timer) {
                    clearTimeout(timer);
                    timer = undefined;
                }
            };

            const finish = () => {
                if (done) return;
                done = true;
                cleanup();
                resolve();
            };
            timer = setTimeout(finish, 2000);
            const onClose = () => finish();
            const onError = () => finish();

            server.once?.("close", onClose);
            server.once?.("error", onError);

            try {
                server.close(() => {
                    finish();
                });
            } catch {
                finish();
            }
        });

        this.httpServer = undefined;

        if (this.activeSseSocket) {
            this.activeSseSocket.destroy();
            this.activeSseSocket = undefined;
        }

        this.activeSseTransport = undefined;
        this.activeSseServer = undefined;
        this.isStopping = false;
    }

    private listenServer(server: ReturnType<typeof createHttpServer>, host: string, port: number) {
        return new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };
            const onListening = () => {
                cleanup();
                resolve();
            };
            const cleanup = () => {
                server.off("error", onError);
                server.off("listening", onListening);
            };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen({ port, host });
        });
    }
}
