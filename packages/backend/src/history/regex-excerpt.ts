import type {
    MatchContext,
    ProjectedHttpSerializationOptionsInput,
    RegexExcerptInput,
} from "./types";

export type RegexExcerptConfig = {
    pattern: RegExp;
    contextChars: number;
};

export const compileRegex = (regex: string | undefined, field: string) => {
    const value = regex?.trim() ?? "";
    if (value.length === 0) return undefined;
    try {
        return new RegExp(value);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid ${field}: ${message}`);
    }
};

export const resolveRegexExcerpt = (
    serialization: ProjectedHttpSerializationOptionsInput | undefined,
) => {
    const input = serialization?.regex_excerpt;
    if (input === undefined || input === null) return undefined;
    const pattern = compileRegex(input.regex, "serialization.regex_excerpt.regex");
    if (pattern === undefined) {
        throw new Error("serialization.regex_excerpt.regex is required");
    }
    return {
        pattern,
        contextChars: Math.max(0, input.context_chars ?? 10),
    };
};

const excerpt = (text: string, matchIndex: number, matchLength: number, contextChars: number) => {
    const start = Math.max(0, matchIndex - contextChars);
    const end = Math.min(text.length, matchIndex + matchLength + contextChars);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < text.length ? "..." : "";
    return `${prefix}${text.slice(start, end)}${suffix}`;
};

const bodyRawPairs = new Map([
    ["request.raw.text", "request.body.text"],
    ["response.raw.text", "response.body.text"],
]);

const bodyRawDuplicateKey = (path: string, text: string) => {
    const bodyPath = bodyRawPairs.get(path) ?? path;
    return `${bodyPath}\0${text}`;
};

export const buildMatchContext = (
    sources: Array<{ path: string; text?: string }>,
    config: RegexExcerptConfig | undefined,
): MatchContext | undefined => {
    if (config === undefined) return undefined;
    const excerpts = [];
    const bodyRawExcerptKeys = new Set<string>();
    for (const source of sources) {
        if (source.text === undefined || source.text === null || source.text === "") continue;
        const flags = config.pattern.flags.includes("g")
            ? config.pattern.flags
            : `${config.pattern.flags}g`;
        const pattern = new RegExp(config.pattern.source, flags);
        let match = pattern.exec(source.text);
        while (match?.index !== undefined) {
            const matchLength = match[0]?.length ?? 0;
            const text = excerpt(source.text, match.index, matchLength, config.contextChars);
            const duplicateKey = bodyRawDuplicateKey(source.path, text);
            if (bodyRawPairs.has(source.path) && bodyRawExcerptKeys.has(duplicateKey)) {
                if (matchLength === 0) pattern.lastIndex += 1;
                match = pattern.exec(source.text);
                continue;
            }
            excerpts.push({
                path: source.path,
                text,
            });
            bodyRawExcerptKeys.add(duplicateKey);
            if (matchLength === 0) pattern.lastIndex += 1;
            match = pattern.exec(source.text);
        }
    }
    return excerpts.length > 0 ? { excerpts } : undefined;
};

export type RegexExcerptInputSchema = RegexExcerptInput;
