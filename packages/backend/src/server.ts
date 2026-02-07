import { Buffer } from "buffer";
import * as net from "net";

import { Blob, Headers, Request, Response } from "caido:http";

declare module "net" {
    interface Socket {
        destroyed?: boolean;
    }
}

export type HandlerResult = {
    response: Response;
    keepOpen?: boolean;
    onSocket?: (socket: net.Socket) => void;
};

export type HttpHandler = (request: Request) => Promise<Response | HandlerResult>;

type ServerOptions = {
    host: string;
    port: number;
    handler: HttpHandler;
    listen?: boolean;
};

type ParsedRequest =
    | { kind: "need_more" }
    | { kind: "chunked_unsupported"; remaining: Uint8Array }
    | { kind: "bad_request"; remaining: Uint8Array }
    | { kind: "ok"; request: Request; remaining: Uint8Array };

const isHandlerResult = (value: unknown): value is HandlerResult => {
    return value !== null && typeof value === "object" && "response" in value;
};

const CR = 13;
const LF = 10;

function findHeaderEnd(buf: Uint8Array): number {
    for (let i = 0; i + 3 < buf.length; i += 1) {
        if (buf[i] === CR && buf[i + 1] === LF && buf[i + 2] === CR && buf[i + 3] === LF) {
            return i;
        }
    }
    return -1;
}

function parseRequest(buffer: Uint8Array): ParsedRequest {
    const headerEnd = findHeaderEnd(buffer);
    if (headerEnd === -1) return { kind: "need_more" };

    const headerBytes = buffer.slice(0, headerEnd);
    const headerText = Buffer.from(headerBytes).toString("latin1");
    const lines = headerText.split("\r\n");
    const [requestLine, ...headerLines] = lines;

    if (requestLine === undefined || requestLine === "") {
        return { kind: "bad_request", remaining: buffer.slice(headerEnd + 4) };
    }

    const [method, target] = requestLine.split(" ");
    if (method === undefined || method === "" || target === undefined || target === "") {
        return { kind: "bad_request", remaining: buffer.slice(headerEnd + 4) };
    }

    const headers = new Headers();
    for (const line of headerLines) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (key !== "") headers.append(key, value);
    }

    const transferEncoding = headers.get("transfer-encoding");
    if (transferEncoding !== null && transferEncoding.toLowerCase().includes("chunked")) {
        return { kind: "chunked_unsupported", remaining: new Uint8Array(0) };
    }

    const contentLengthHeader = headers.get("content-length");
    const contentLength =
        contentLengthHeader !== null && contentLengthHeader !== ""
            ? Number(contentLengthHeader)
            : 0;
    if (!Number.isFinite(contentLength) || contentLength < 0) {
        return { kind: "bad_request", remaining: buffer.slice(headerEnd + 4) };
    }

    const bodyStart = headerEnd + 4;
    const totalNeeded = bodyStart + contentLength;
    if (buffer.length < totalNeeded) return { kind: "need_more" };

    const bodyBytes = contentLength > 0 ? buffer.slice(bodyStart, totalNeeded) : undefined;
    const remaining = buffer.slice(totalNeeded);

    const host = headers.get("host");
    if (!target.startsWith("http://") && !target.startsWith("https://")) {
        if (host === null || host === "") {
            return { kind: "bad_request", remaining };
        }
    }

    let url: string;
    if (target.startsWith("http://") || target.startsWith("https://")) {
        url = target;
    } else {
        const origin = `http://${host ?? "127.0.0.1"}`;
        if (target === "*") {
            url = `${origin}/`;
        } else if (target.startsWith("/")) {
            url = `${origin}${target}`;
        } else {
            url = `${origin}/${target}`;
        }
    }

    const bodyBuffer = bodyBytes
        ? bodyBytes.buffer.slice(bodyBytes.byteOffset, bodyBytes.byteOffset + bodyBytes.byteLength)
        : undefined;
    const request = new Request(url, {
        method,
        headers,
        body: bodyBuffer ? new Blob([bodyBuffer]) : undefined,
    });

    return { kind: "ok", request, remaining };
}

function shouldKeepAliveByRequest(request: Request): boolean {
    const conn = request.headers.get("connection");
    return !(conn !== null && conn.toLowerCase().includes("close"));
}

type BodyStream = {
    getReader: () => {
        read: () => Promise<{
            done: boolean;
            value?: Uint8Array | ArrayBuffer | string;
        }>;
    };
};

function isBodyStream(body: unknown): body is BodyStream {
    if (body === null || body === undefined) return false;
    return typeof (body as BodyStream).getReader === "function";
}

async function writeResponse(socket: net.Socket, response: Response, keepOpen: boolean) {
    const bodyAny = (response as { body?: unknown }).body;
    const isStream = isBodyStream(bodyAny);

    const headers = new Headers(response.headers);
    headers.set("connection", keepOpen ? "keep-alive" : "close");
    const contentType = headers.get("content-type") ?? "";
    const isSse = contentType.includes("text/event-stream");
    if (isStream || isSse) {
        headers.delete("content-length");
        headers.delete("transfer-encoding");
    }

    if (
        !isStream &&
        !isSse &&
        !headers.has("content-length") &&
        !headers.has("transfer-encoding")
    ) {
        const bodyBuf = Buffer.from(await response.arrayBuffer());
        headers.set("content-length", String(bodyBuf.length));

        let headerText = `HTTP/1.1 ${response.status} ${response.statusText || ""}\r\n`;
        headers.forEach((value, key) => {
            headerText += `${key}: ${value}\r\n`;
        });
        headerText += "\r\n";

        socket.write(Buffer.from(headerText, "utf8"));
        if (bodyBuf.length > 0) socket.write(bodyBuf);
        if (!keepOpen) socket.end();
        return;
    }

    let headerText = `HTTP/1.1 ${response.status} ${response.statusText || ""}\r\n`;
    headers.forEach((value, key) => {
        headerText += `${key}: ${value}\r\n`;
    });
    headerText += "\r\n";
    socket.write(Buffer.from(headerText, "utf8"));

    if (isSse && !isStream) {
        if (!keepOpen) socket.end();
        return;
    }

    if (isStream) {
        const reader = bodyAny.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk: unknown = value;
            if (chunk === undefined) continue;
            if (ArrayBuffer.isView(chunk)) {
                socket.write(Buffer.from(chunk.buffer));
                continue;
            }
            if (chunk instanceof ArrayBuffer) {
                socket.write(Buffer.from(new Uint8Array(chunk)));
                continue;
            }
            if (typeof chunk === "string") {
                socket.write(Buffer.from(chunk, "utf8"));
                continue;
            }
            if (chunk !== null && typeof chunk === "object") {
                if ("data" in chunk) {
                    const v = chunk as {
                        event?: string;
                        data?: unknown;
                        id?: string;
                        retry?: number;
                    };
                    let out = "";
                    if (typeof v.event === "string") out += `event: ${v.event}\n`;
                    if (typeof v.id === "string") out += `id: ${v.id}\n`;
                    if (typeof v.retry === "number") out += `retry: ${v.retry}\n`;
                    const dataStr =
                        typeof v.data === "string" ? v.data : JSON.stringify(v.data ?? "");
                    out += `data: ${dataStr}\n\n`;
                    socket.write(Buffer.from(out, "utf8"));
                    continue;
                }
                if (contentType.includes("application/json")) {
                    socket.write(Buffer.from(JSON.stringify(chunk), "utf8"));
                    continue;
                }
                socket.write(Buffer.from(JSON.stringify(chunk), "utf8"));
                continue;
            }
            if (
                typeof chunk === "string" ||
                typeof chunk === "number" ||
                typeof chunk === "boolean" ||
                typeof chunk === "bigint"
            ) {
                socket.write(Buffer.from(String(chunk), "utf8"));
            }
        }
        if (!keepOpen) socket.end();
        return;
    }

    const bodyBuf = Buffer.from(await response.arrayBuffer());
    if (bodyBuf.length > 0) socket.write(bodyBuf);
    if (!keepOpen) socket.end();
}

export function createHttpServer({ host, port, handler, listen = true }: ServerOptions) {
    const server = net.createServer((socket) => {
        let buffer: Uint8Array = new Uint8Array(new ArrayBuffer(0));
        let chain: Promise<void> = Promise.resolve();

        const enqueue = (fn: () => Promise<void>) => {
            chain = chain.then(fn).catch(() => {
                try {
                    socket.destroy();
                } catch {
                    return;
                }
            });
        };

        socket.on("error", () => {
            try {
                socket.destroy();
            } catch {
                return;
            }
        });

        socket.on("data", (chunk: Uint8Array) => {
            enqueue(async () => {
                const merged = new Uint8Array(new ArrayBuffer(buffer.length + chunk.length));
                merged.set(buffer, 0);
                merged.set(chunk, buffer.length);
                buffer = merged;

                while (true) {
                    const parsed = parseRequest(buffer);

                    if (parsed.kind === "need_more") return;

                    if (parsed.kind === "chunked_unsupported") {
                        const resp = new Response(
                            new Blob(["Transfer-Encoding: chunked is not supported"]),
                            {
                                status: 501,
                            },
                        );
                        await writeResponse(socket, resp, false);
                        socket.end();
                        return;
                    }

                    if (parsed.kind === "bad_request") {
                        buffer = parsed.remaining;
                        const resp = new Response(new Blob(["Bad Request"]), {
                            status: 400,
                        });
                        await writeResponse(socket, resp, false);
                        return;
                    }

                    buffer = parsed.remaining;

                    const reqKeepAlive = shouldKeepAliveByRequest(parsed.request);

                    try {
                        const result = await handler(parsed.request);

                        if (isHandlerResult(result)) {
                            const r = result;
                            const keepOpen =
                                typeof r.keepOpen === "boolean" ? r.keepOpen : reqKeepAlive;
                            if (keepOpen && r.onSocket) r.onSocket(socket);
                            await writeResponse(socket, r.response, keepOpen);
                            if (!keepOpen) return;
                        } else {
                            {
                                const keepOpen = reqKeepAlive;
                                {
                                    await writeResponse(socket, result, keepOpen);
                                    if (!keepOpen) return;
                                }
                            }
                        }
                    } catch {
                        const resp = new Response(new Blob(["Internal Server Error"]), {
                            status: 500,
                        });
                        await writeResponse(socket, resp, false);
                        return;
                    }

                    if (socket.destroyed === true) return;
                }
            });
        });
    });

    if (listen) server.listen({ port, host });
    return server;
}
