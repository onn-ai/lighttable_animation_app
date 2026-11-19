import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reactDir = resolve(root, "node_modules/react");
mkdirSync(reactDir, { recursive: true });
writeFileSync(resolve(reactDir, "package.json"), JSON.stringify({ name: "react", version: "0.0.0-test-stub", type: "module", exports: "./index.js" }, null, 2));
writeFileSync(resolve(reactDir, "index.js"), readFileSync(resolve(root, "tests/mocks/react/index.js"), "utf8"));
