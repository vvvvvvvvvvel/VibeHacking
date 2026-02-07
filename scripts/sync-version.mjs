import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const rootDir = process.cwd();
const rootPkgPath = join(rootDir, "package.json");

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const writeJson = async (path, data) => writeFile(path, JSON.stringify(data, null, 2) + "\n");

const rootPkg = await readJson(rootPkgPath);
const version = rootPkg.version;
if (!version || typeof version !== "string") {
    throw new Error("Root package.json is missing a valid version");
}

const packageJsonPaths = [
    join(rootDir, "packages/backend/package.json"),
    join(rootDir, "packages/frontend/package.json"),
    join(rootDir, "packages/shared/package.json"),
];

await Promise.all(
    packageJsonPaths.map(async (path) => {
        const pkg = await readJson(path);
        if (pkg.version !== version) {
            pkg.version = version;
            await writeJson(path, pkg);
        }
    }),
);

const sharedIndexPath = join(rootDir, "packages/shared/src/index.ts");
const sharedIndex = await readFile(sharedIndexPath, "utf8");

const nextSharedIndex = sharedIndex.replace(
    /export const MCP_PLUGIN_VERSION = ".*";/,
    `export const MCP_PLUGIN_VERSION = "${version}";`,
);

if (nextSharedIndex !== sharedIndex) {
    await writeFile(sharedIndexPath, nextSharedIndex);
}

const caidoConfigPath = join(rootDir, "caido.config.ts");
const caidoConfig = await readFile(caidoConfigPath, "utf8");
const nextCaidoConfig = caidoConfig.replace(/version:\s*"[^"]+"/, `version: "${version}"`);
if (nextCaidoConfig !== caidoConfig) {
    await writeFile(caidoConfigPath, nextCaidoConfig);
}

console.log(`Synced version ${version}`);
