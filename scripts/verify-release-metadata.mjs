import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const server = JSON.parse(fs.readFileSync("server.json", "utf8"));
const indexSource = fs.readFileSync("src/index.ts", "utf8");

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

const npmPackage = server.packages?.find((entry) => entry.registryType === "npm");
const runtimeVersionMatch = indexSource.match(/version:\s*"([^"]+)"/);
const runtimeVersion = runtimeVersionMatch?.[1];

check(pkg.name === "@scrapeer/mcp-server", "package.json name must be @scrapeer/mcp-server");
check(pkg.mcpName === server.name, "package.json mcpName must match server.json name");
check(server.name === "com.scrapeer/mcp-server", "server.json name must be com.scrapeer/mcp-server");
check(server.version === pkg.version, "server.json version must match package.json version");
check(npmPackage, "server.json must include an npm package entry");
check(npmPackage?.identifier === pkg.name, "server.json npm identifier must match package.json name");
check(npmPackage?.version === pkg.version, "server.json npm package version must match package.json version");
check(npmPackage?.transport?.type === "stdio", "server.json npm package transport must be stdio");
check(runtimeVersion === pkg.version, "src/index.ts McpServer version must match package.json version");

if (failures.length > 0) {
  console.error("Release metadata check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`release-metadata-ok ${pkg.name}@${pkg.version} -> ${server.name}`);
