import { spawn } from "node:child_process";
import { validateRuntimeSecrets } from "./config.mjs";

try {
  validateRuntimeSecrets();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Runtime configuration is invalid");
  process.exit(1);
}

const child = spawn("node_modules/.bin/next", ["start"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
