import { Buffer } from "buffer";

import { z } from "zod";

const rawHttpConnectionShape = {
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    is_tls: z.boolean().optional(),
};

export const rawHttpRequestSchema = z.union([
    z
        .object({
            raw_text: z.string().min(1),
            ...rawHttpConnectionShape,
        })
        .strict(),
    z
        .object({
            raw_base64: z.string().min(1),
            ...rawHttpConnectionShape,
        })
        .strict(),
]);

export type RawHttpRequestInput = z.infer<typeof rawHttpRequestSchema>;

export const decodeRawHttpRequest = (input: RawHttpRequestInput): Buffer => {
    if ("raw_text" in input) {
        return Buffer.from(input.raw_text, "utf8");
    }
    return Buffer.from(input.raw_base64, "base64");
};

export const rawHttpRequestConnection = (input: RawHttpRequestInput) => ({
    host: input.host,
    port: input.port,
    isTls: input.is_tls ?? input.port === 443,
});
