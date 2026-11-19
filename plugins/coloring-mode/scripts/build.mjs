import { execFileSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";

rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
mkdirSync(new URL("../dist", import.meta.url), { recursive: true });
execFileSync("tsc", ["-p", new URL("../tsconfig.json", import.meta.url).pathname], { stdio: "inherit" });
