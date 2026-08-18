import { cp, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..");
const root = resolve(desktopDir, "..");

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm", ["run", "build"], resolve(root, "backend"));
run("npm", ["run", "build"], resolve(root, "ops"));
run("npm", ["run", "build"], resolve(root, "frontend"), {
  ...process.env,
  VITE_EVENT_MODE: "competition",
  VITE_API_BASE_URL: "http://127.0.0.1:7070",
});

const resourceFrontend = resolve(desktopDir, "resources/frontend");
await rm(resourceFrontend, { recursive: true, force: true });
await mkdir(resolve(desktopDir, "resources"), { recursive: true });
await cp(resolve(root, "frontend/dist"), resourceFrontend, { recursive: true });

await build({
  entryPoints: [resolve(desktopDir, "src/main.ts")],
  outfile: resolve(desktopDir, "dist/main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: ["electron", "serialport"],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  define: { "process.env.APP_VERSION": JSON.stringify("1.0.0") },
});
