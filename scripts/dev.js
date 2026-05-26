import { spawn } from "node:child_process";
import path from "node:path";

const sourceRoot = parseSourceRoot(process.argv.slice(2));
const root = process.cwd();
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const children = [
  spawn(npm, ["--prefix", "server", "run", "dev", "--", ...(sourceRoot ? ["--source", sourceRoot] : [])], {
    cwd: root,
    stdio: "inherit",
    shell: false
  }),
  spawn(npm, ["--prefix", "client", "run", "dev"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env
  })
];

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      stopAll();
      process.exit(code);
    }
    if (signal) {
      stopAll();
      process.kill(process.pid, signal);
    }
  });
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

function parseSourceRoot(args) {
  const flagIndex = args.findIndex((arg) => arg === "--source" || arg === "--source-root");
  const fromFlag = flagIndex >= 0 ? args[flagIndex + 1] : "";
  const fromPosition = args.find((arg) => !arg.startsWith("--"));
  const value = fromFlag || fromPosition || "";
  return value ? path.resolve(value) : "";
}
