/* eslint-disable no-console */
import { readFile } from "fs/promises";
import { resolve } from "path";

import { buildClientSchema, parse, validate } from "graphql";

import * as documents from "../packages/backend/src/graphql";

const main = async () => {
    const schemaPath = resolve(process.cwd(), "gql.txt");
    const introspection = JSON.parse(await readFile(schemaPath, "utf8")) as {
        data?: unknown;
        errors?: unknown[];
    };

    if (introspection.errors !== undefined && introspection.errors.length > 0) {
        throw new Error(`gql.txt contains ${introspection.errors.length} GraphQL error(s)`);
    }
    if (introspection.data === undefined) {
        throw new Error("gql.txt does not contain introspection data");
    }

    const schema = buildClientSchema(introspection.data as Parameters<typeof buildClientSchema>[0]);
    const failures: string[] = [];
    let validated = 0;

    for (const [name, value] of Object.entries(documents)) {
        if (typeof value !== "string" || !/^\s*(query|mutation|subscription)\b/.test(value)) {
            continue;
        }
        validated += 1;
        try {
            const errors = validate(schema, parse(value));
            for (const error of errors) failures.push(`${name}: ${error.message}`);
        } catch (error) {
            failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (failures.length > 0) {
        throw new Error(
            `GraphQL validation failed:\n${failures.map((item) => `- ${item}`).join("\n")}`,
        );
    }

    console.log(`Validated ${validated} GraphQL documents against gql.txt`);
};

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
