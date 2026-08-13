import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const localRoot = path.join(projectRoot, ".local");
const logPath = path.join(localRoot, "dev.log");
const pidPath = path.join(localRoot, "dev.pid");
const devScript = path.join(projectRoot, "scripts", "dev.mjs");
const localUrl = "http://localhost:3000/";
const companionHealthUrl = "http://127.0.0.1:4317/health";
const shouldOpen = !process.argv.includes("--no-open");

async function endpointIsReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

async function appIsReady() {
  const [web, companion] = await Promise.all([
    endpointIsReady(localUrl),
    endpointIsReady(companionHealthUrl),
  ]);
  return web && companion;
}

async function waitUntilReady(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await appIsReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function openBrowser() {
  if (!shouldOpen) return;
  const opener = spawn("/usr/bin/open", [localUrl], {
    detached: true,
    stdio: "ignore",
  });
  opener.unref();
}

function showStartupError() {
  if (!shouldOpen) return;
  const message = `Daily arXiv를 시작하지 못했습니다. ${logPath} 로그를 확인해주세요.`;
  const dialog = spawn("/usr/bin/osascript", [
    "-e",
    `display alert ${JSON.stringify("Daily arXiv")} message ${JSON.stringify(message)}`,
  ], { detached: true, stdio: "ignore" });
  dialog.unref();
}

async function stopManagedServer() {
  let pid;
  try {
    pid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
  } catch {
    process.stdout.write("No background Daily arXiv process is recorded.\n");
    return;
  }
  if (!Number.isInteger(pid) || pid <= 1) {
    await unlink(pidPath).catch(() => undefined);
    throw new Error("Invalid background process record.");
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await unlink(pidPath).catch(() => undefined);
  process.stdout.write("Background Daily arXiv process stopped.\n");
}

if (process.argv.includes("--stop")) {
  await stopManagedServer();
  process.exit(0);
}

await mkdir(localRoot, { recursive: true });

if (!await appIsReady()) {
  const logFile = openSync(logPath, "a");
  const child = spawn(process.execPath, [devScript], {
    cwd: projectRoot,
    detached: true,
    env: process.env,
    stdio: ["ignore", logFile, logFile],
  });
  closeSync(logFile);
  if (!child.pid) throw new Error("Daily arXiv background process did not start.");
  await writeFile(pidPath, `${child.pid}\n`, "utf8");
  child.unref();
}

if (await waitUntilReady()) {
  openBrowser();
  process.stdout.write(`${localUrl}\n`);
} else {
  showStartupError();
  process.exitCode = 1;
}
