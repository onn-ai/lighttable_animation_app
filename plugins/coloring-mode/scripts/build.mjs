import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(scriptDir);
const projectRoot = dirname(dirname(pluginRoot));
const outputDir = join(pluginRoot, "dist");
const tsconfigPath = join(pluginRoot, "tsconfig.json");

// Resolve TypeScript from the host application's dependencies. On Windows,
// node_modules/.bin/tsc is a .cmd shim, which cannot be launched reliably by
// child_process.execFileSync("tsc"). Invoking the package's JS CLI with the
// current Node executable works consistently across operating systems.
const projectRequire = createRequire(join(projectRoot, "package.json"));
let tscCli;
try {
  tscCli = projectRequire.resolve("typescript/bin/tsc");
} catch (error) {
  throw new Error(
    "TypeScript is not installed in the LightTable project. Run `npm install` from the project root, then retry.",
    { cause: error },
  );
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

execFileSync(process.execPath, [tscCli, "-p", tsconfigPath], {
  cwd: projectRoot,
  stdio: "inherit",
});
