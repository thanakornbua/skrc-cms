import { existsSync } from "node:fs";
import * as esbuild from "esbuild";
import { buildSingleFileZip } from "./zip.js";

/**
 * Bundles an already-compiled backend/dist/**.js entry point (real .js
 * files with real .js sibling imports — no TS-extension resolution
 * guesswork) into a single-file CJS Lambda deployment zip.
 */
export async function bundleLambdaFromDist(entryFile: string): Promise<Buffer> {
  if (!existsSync(entryFile)) {
    throw new Error(
      `${entryFile} does not exist — run "npm run build" in backend/ first.`
    );
  }

  const result = await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    write: false,
  });

  const code = result.outputFiles[0].text;
  return buildSingleFileZip("index.js", code);
}
