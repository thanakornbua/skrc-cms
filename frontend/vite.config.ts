import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const REQUIRED = ["VITE_EVENT_MODE", "VITE_REGWEEK_API_URL", "VITE_API_BASE_URL", "VITE_COGNITO_USER_POOL_ID", "VITE_COGNITO_CLIENT_ID", "VITE_CONTROL_API_URL"] as const;

function deploymentManifest(values: Record<string, string>): Plugin {
  return {
    name: "deployment-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "deployment-manifest.json",
        source: JSON.stringify({
          commit: process.env.AWS_COMMIT_ID ?? process.env.GIT_COMMIT ?? "local",
          branch: process.env.AWS_BRANCH ?? "local",
          eventMode: values.VITE_EVENT_MODE,
          regweekApiUrl: values.VITE_REGWEEK_API_URL,
          competitionApiUrl: values.VITE_API_BASE_URL,
          cognitoUserPoolId: values.VITE_COGNITO_USER_POOL_ID,
          builtAt: new Date().toISOString(),
        }, null, 2),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const values = loadEnv(mode, process.cwd(), "");
  for (const name of REQUIRED) if (!values[name]) throw new Error(`Missing required build variable ${name}`);
  if (!["registration", "competition", "concluded"].includes(values.VITE_EVENT_MODE)) throw new Error("VITE_EVENT_MODE must be registration, competition, or concluded");
  for (const name of ["VITE_REGWEEK_API_URL", "VITE_API_BASE_URL", "VITE_CONTROL_API_URL"] as const) new URL(values[name]);
  if (values.VITE_EVENT_MODE === "concluded" && !existsSync(resolve(process.cwd(), "public/results.json"))) {
    throw new Error("Concluded builds require frontend/public/results.json");
  }
  return { plugins: [react(), deploymentManifest(values)] };
});
