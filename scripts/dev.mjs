import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const vinext = path.join(projectRoot, "node_modules", ".bin", "vinext");

const companion = spawn(process.execPath, [path.join(projectRoot, "scripts", "local-companion.mjs")], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

const web = spawn(vinext, ["dev"], {
  cwd: projectRoot,
  env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
  stdio: "inherit",
});

let closing = false;

function stop(signal = "SIGTERM") {
  if (closing) return;
  closing = true;
  companion.kill(signal);
  web.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

companion.on("exit", (code) => {
  if (!closing) {
    stop();
    process.exitCode = code ?? 1;
  }
});

web.on("exit", (code) => {
  if (!closing) {
    stop();
    process.exitCode = code ?? 1;
  }
});
