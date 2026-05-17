import { Blob, Response as CaidoResponse } from "caido:http";
import type { Request as CaidoRequest } from "caido:http";

import { createHttpServer, type HttpHandler } from "./server";
import type { MCPSDK } from "./types/sdk";

const CONTROL_BIND_HOST = "127.0.0.1";

type RuntimeServer = ReturnType<typeof createHttpServer>;

type Route = {
    path: string;
    handler: HttpHandler;
};

type ListenerSpec = {
    id: string;
    host: string;
    port: number;
    routes: Route[];
    hasMcp: boolean;
};

type ListenerState = {
    spec: ListenerSpec;
    server: RuntimeServer;
};

type ListenerManagerOptions = {
    sdk: MCPSDK;
    controlEndpointPath: string;
    mcpEndpointPath: string;
    controlHandler: HttpHandler;
    mcpHandler: HttpHandler;
    isMcpEnabled: () => boolean;
    onBeforeMcpListenerStop?: () => Promise<void>;
    onUnexpectedMcpStop?: () => void;
};

type ApplyOptions = {
    mcpHost: string;
    port: number;
    mcpEnabled: boolean;
};

const normalizeHost = (host: string) =>
    host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");

const getRequestPath = (req: CaidoRequest) => {
    const urlStr = req.url;
    const pathStart =
        urlStr.indexOf("://") >= 0
            ? urlStr.indexOf("/", urlStr.indexOf("://") + 3)
            : urlStr.indexOf("/");
    return pathStart >= 0 ? urlStr.slice(pathStart).split("?")[0] : "/";
};

const getBindHost = (host: string) => {
    const normalized = normalizeHost(host);
    return normalized === "localhost" ? CONTROL_BIND_HOST : host.trim();
};

const canShareControlListener = (host: string) => {
    const bindHost = normalizeHost(getBindHost(host));
    return bindHost === CONTROL_BIND_HOST || bindHost === "0.0.0.0";
};

export class McpListenerManager {
    private readonly sdk: MCPSDK;
    private readonly controlEndpointPath: string;
    private readonly mcpEndpointPath: string;
    private readonly controlHandler: HttpHandler;
    private readonly mcpHandler: HttpHandler;
    private readonly isMcpEnabled: () => boolean;
    private readonly onBeforeMcpListenerStop: (() => Promise<void>) | undefined;
    private readonly onUnexpectedMcpStop: (() => void) | undefined;
    private listeners: ListenerState[] = [];
    private signature = "";
    private mcpActive = false;
    private readonly closingServers = new Set<RuntimeServer>();

    constructor(options: ListenerManagerOptions) {
        this.sdk = options.sdk;
        this.controlEndpointPath = options.controlEndpointPath;
        this.mcpEndpointPath = options.mcpEndpointPath;
        this.controlHandler = options.controlHandler;
        this.mcpHandler = options.mcpHandler;
        this.isMcpEnabled = options.isMcpEnabled;
        this.onBeforeMcpListenerStop = options.onBeforeMcpListenerStop;
        this.onUnexpectedMcpStop = options.onUnexpectedMcpStop;
    }

    async apply(options: ApplyOptions) {
        const specs = this.createSpecs(options);
        const nextSignature = this.createSignature(specs);
        await this.applyNow(options, specs, nextSignature);
    }

    async stop() {
        if (this.mcpActive) {
            await this.onBeforeMcpListenerStop?.();
        }
        this.mcpActive = false;
        await this.closeListeners(this.listeners);
    }

    private async applyNow(
        options: ApplyOptions,
        specs = this.createSpecs(options),
        nextSignature = this.createSignature(specs),
    ) {
        const closingListeners = this.getClosingListeners(specs);

        if (
            this.mcpActive &&
            (!options.mcpEnabled || closingListeners.some((listener) => listener.spec.hasMcp))
        ) {
            await this.onBeforeMcpListenerStop?.();
        }

        if (nextSignature === this.signature) {
            this.mcpActive = options.mcpEnabled;
            return;
        }

        const specsToRestore = closingListeners.map((listener) => listener.spec);
        const previousMcpActive = this.mcpActive;
        const startedListeners: ListenerState[] = [];
        try {
            await this.closeListeners(closingListeners);
            const activeKeys = new Set(
                this.listeners.map((listener) => this.createSpecKey(listener.spec)),
            );
            for (const spec of specs.filter(
                (candidate) => !activeKeys.has(this.createSpecKey(candidate)),
            )) {
                startedListeners.push(await this.openListener(spec));
            }
            this.signature = nextSignature;
            this.mcpActive = options.mcpEnabled;
        } catch (err) {
            await this.closeListeners(startedListeners);
            await this.restoreClosedListeners(specsToRestore);
            this.signature = this.createSignature(this.listeners.map((listener) => listener.spec));
            this.mcpActive = previousMcpActive;
            throw err;
        }
    }

    private createSpecs({ mcpHost, port, mcpEnabled }: ApplyOptions): ListenerSpec[] {
        const controlRoute = {
            path: this.controlEndpointPath,
            handler: this.controlHandler,
        };
        const mcpRoute = {
            path: this.mcpEndpointPath,
            handler: async (...args: Parameters<HttpHandler>) => {
                if (!this.isMcpEnabled()) {
                    return new CaidoResponse(new Blob(["MCP server is disabled"]), {
                        status: 503,
                    });
                }
                return await this.mcpHandler(...args);
            },
        };

        if (canShareControlListener(mcpHost)) {
            return [
                {
                    id: "combined",
                    host: getBindHost(mcpHost),
                    port,
                    routes: [controlRoute, mcpRoute],
                    hasMcp: true,
                },
            ];
        }

        const specs: ListenerSpec[] = [
            {
                id: "control",
                host: CONTROL_BIND_HOST,
                port,
                routes: [controlRoute],
                hasMcp: false,
            },
        ];

        if (mcpEnabled) {
            specs.push({
                id: "mcp",
                host: getBindHost(mcpHost),
                port,
                routes: [mcpRoute],
                hasMcp: true,
            });
        }

        return specs;
    }

    private createRoutedHandler(routes: Route[]): HttpHandler {
        return async (request, context) => {
            const path = getRequestPath(request);
            const route = routes.find((candidate) => candidate.path === path);
            if (route === undefined) {
                return new CaidoResponse(new Blob(["Not Found"]), { status: 404 });
            }
            return await route.handler(request, context);
        };
    }

    private createSignature(specs: ListenerSpec[]) {
        return specs.map((spec) => this.createSpecKey(spec)).join("|");
    }

    private createSpecKey(spec: ListenerSpec) {
        const routes = spec.routes.map((route) => route.path).join(",");
        return `${spec.id}:${spec.host}:${spec.port}:${routes}:${spec.hasMcp ? "mcp" : "control"}`;
    }

    private getClosingListeners(nextSpecs: ListenerSpec[]) {
        const nextKeys = new Set(nextSpecs.map((spec) => this.createSpecKey(spec)));
        return this.listeners.filter(
            (listener) => !nextKeys.has(this.createSpecKey(listener.spec)),
        );
    }

    private attachRuntimeHandlers(server: RuntimeServer, spec: ListenerSpec) {
        server.on("error", (err: Error) => {
            this.sdk.console.error(`MCP listener ${spec.id} error: ${err}`);
            this.handleUnexpectedStop(server, spec);
        });
        server.on("close", () => {
            this.handleUnexpectedStop(server, spec);
        });
    }

    private async openListener(spec: ListenerSpec): Promise<ListenerState> {
        const server = createHttpServer({
            host: spec.host,
            port: spec.port,
            listen: false,
            handler: this.createRoutedHandler(spec.routes),
        });
        try {
            await this.listenServer(server, spec);
        } catch (err) {
            try {
                server.close();
            } catch {
                // Ignore cleanup errors.
            }
            throw err;
        }
        this.attachRuntimeHandlers(server, spec);
        const listener = { spec, server };
        this.listeners.push(listener);
        return listener;
    }

    private async restoreClosedListeners(specs: ListenerSpec[]) {
        for (const spec of specs) {
            const key = this.createSpecKey(spec);
            if (this.listeners.some((listener) => this.createSpecKey(listener.spec) === key)) {
                continue;
            }
            try {
                await this.openListener(spec);
            } catch (err) {
                this.sdk.console.error(`Failed to restore MCP listener ${spec.id}: ${err}`);
            }
        }
    }

    private handleUnexpectedStop(server: RuntimeServer, spec: ListenerSpec) {
        if (this.closingServers.has(server)) return;

        const before = this.listeners.length;
        this.listeners = this.listeners.filter((listener) => listener.server !== server);
        if (this.listeners.length === before) return;

        this.signature = this.createSignature(this.listeners.map((listener) => listener.spec));
        if (spec.hasMcp) {
            this.onUnexpectedMcpStop?.();
        }
    }

    private async closeListeners(listeners: ListenerState[]) {
        if (listeners.length === 0) {
            return;
        }

        const closing = new Set(listeners.map((listener) => listener.server));
        this.listeners = this.listeners.filter((listener) => !closing.has(listener.server));
        this.signature = this.createSignature(this.listeners.map((listener) => listener.spec));
        listeners.forEach((listener) => this.closingServers.add(listener.server));
        try {
            await Promise.all(listeners.map((listener) => this.closeServer(listener.server)));
        } finally {
            listeners.forEach((listener) => this.closingServers.delete(listener.server));
        }
    }

    private listenServer(server: RuntimeServer, spec: ListenerSpec) {
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
            server.listen({ port: spec.port, host: spec.host });
        });
    }

    private closeServer(server: RuntimeServer) {
        return new Promise<void>((resolve) => {
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
            const onClose = () => finish();
            const onError = () => finish();

            server.once?.("close", onClose);
            server.once?.("error", onError);

            try {
                server.close(() => {
                    finish();
                });
                timer = setTimeout(finish, 0);
            } catch {
                finish();
            }
        });
    }
}
