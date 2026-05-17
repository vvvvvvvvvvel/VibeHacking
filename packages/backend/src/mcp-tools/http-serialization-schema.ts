import { z } from "zod";

import {
    DEFAULT_MAX_BINARY_BODY_BYTES,
    DEFAULT_MAX_TEXT_BODY_CHARS,
    type ProjectedHttpSerializationOptionsInput,
} from "../history";

const DEFAULT_REGEX_EXCERPT_CONTEXT_CHARS = 10;

const regexExcerptObjectSchema = z
    .object({
        context_chars: z.number().int().min(0).default(DEFAULT_REGEX_EXCERPT_CONTEXT_CHARS),
        regex: z.string().min(1),
    })
    .strict();

const regexExcerptSchema = z.preprocess(
    (value) => (typeof value === "string" ? { regex: value.trim() } : value),
    regexExcerptObjectSchema,
);

export const defaultListHttpSerialization = {
    include_body: false,
    include_binary: false,
    max_text_body_chars: DEFAULT_MAX_TEXT_BODY_CHARS,
    text_overflow_mode: "omit" as const,
    max_binary_body_bytes: DEFAULT_MAX_BINARY_BODY_BYTES,
} satisfies ProjectedHttpSerializationOptionsInput;

export const defaultHttpSerialization = {
    include_body: true,
    include_binary: false,
    max_text_body_chars: DEFAULT_MAX_TEXT_BODY_CHARS,
    text_overflow_mode: "omit" as const,
    max_binary_body_bytes: DEFAULT_MAX_BINARY_BODY_BYTES,
} satisfies ProjectedHttpSerializationOptionsInput;

export const makeHttpSerializationSchema = (defaults: ProjectedHttpSerializationOptionsInput) => {
    const fieldDefaults = {
        include_body: defaults.include_body ?? true,
        include_binary: defaults.include_binary ?? false,
        max_text_body_chars: defaults.max_text_body_chars ?? DEFAULT_MAX_TEXT_BODY_CHARS,
        max_request_body_chars: defaults.max_request_body_chars ?? null,
        max_response_body_chars: defaults.max_response_body_chars ?? null,
        text_overflow_mode: defaults.text_overflow_mode ?? "omit",
        max_binary_body_bytes: defaults.max_binary_body_bytes ?? DEFAULT_MAX_BINARY_BODY_BYTES,
        regex_excerpt: null,
    } as const;
    const objectDefault = {
        ...fieldDefaults,
        max_request_body_chars: undefined,
        max_response_body_chars: undefined,
        regex_excerpt: undefined,
    };
    return z
        .object({
            include_body: z.boolean().default(fieldDefaults.include_body),
            include_binary: z.boolean().default(fieldDefaults.include_binary),
            max_text_body_chars: z.number().int().min(0).default(fieldDefaults.max_text_body_chars),
            max_request_body_chars: z
                .number()
                .int()
                .min(0)
                .nullable()
                .default(null)
                .transform((value) => value ?? undefined),
            max_response_body_chars: z
                .number()
                .int()
                .min(0)
                .nullable()
                .default(null)
                .transform((value) => value ?? undefined),
            text_overflow_mode: z
                .enum(["truncate", "omit"])
                .default(fieldDefaults.text_overflow_mode),
            max_binary_body_bytes: z
                .number()
                .int()
                .min(0)
                .default(fieldDefaults.max_binary_body_bytes),
            regex_excerpt: regexExcerptSchema
                .nullable()
                .default(null)
                .transform((value) => value ?? undefined),
        })
        .strict()
        .default(objectDefault);
};

export const listHttpSerializationSchema = makeHttpSerializationSchema(
    defaultListHttpSerialization,
);

export const httpSerializationSchema = makeHttpSerializationSchema(defaultHttpSerialization);
