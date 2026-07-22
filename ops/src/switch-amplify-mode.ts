import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const value = (flag: string) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
const appId = value("--app-id") ?? process.env.AMPLIFY_APP_ID;
const branchName = value("--branch") ?? process.env.AMPLIFY_BRANCH ?? "main";
const eventMode = value("--mode");
const expectedCommit = value("--expected-commit");
const confirm = value("--confirm");
if (!appId || !eventMode || !expectedCommit) throw new Error("--app-id, --mode, and --expected-commit are required");
if (!["registration", "competition", "concluded"].includes(eventMode)) throw new Error("--mode must be registration, competition, or concluded");
if (confirm !== `DEPLOY-${eventMode.toUpperCase()}`) throw new Error(`Pass --confirm DEPLOY-${eventMode.toUpperCase()}`);
if (eventMode === "concluded" && !args.includes("--results-committed")) throw new Error("Concluded mode requires --results-committed after results.json is committed");

const region = process.env.AMPLIFY_REGION ?? "ap-southeast-1";
function aws<T>(arguments_: string[]): T {
  return JSON.parse(execFileSync("aws", [...arguments_, "--region", region, "--output", "json"], { encoding: "utf8" })) as T;
}
const branch = aws<{ branch: { activeJobId?: string; environmentVariables?: Record<string, string> } }>(["amplify", "get-branch", "--app-id", appId, "--branch-name", branchName]).branch;
if (!branch?.activeJobId) throw new Error(`Branch ${branchName} has no deployed job`);
const deployed = aws<{ job?: { summary?: { commitId?: string } } }>(["amplify", "get-job", "--app-id", appId, "--branch-name", branchName, "--job-id", branch.activeJobId]).job?.summary;
if (deployed?.commitId !== expectedCommit) throw new Error(`Refusing deployment: ${branchName} is ${deployed?.commitId ?? "unknown"}, expected ${expectedCommit}`);
const app = aws<{ app?: { environmentVariables?: Record<string, string> } }>(["amplify", "get-app", "--app-id", appId]).app;
const environmentVariables = { ...(app?.environmentVariables ?? {}), ...(branch.environmentVariables ?? {}), VITE_EVENT_MODE: eventMode };
aws(["amplify", "update-branch", "--app-id", appId, "--branch-name", branchName, "--environment-variables", JSON.stringify(environmentVariables)]);
const started = aws<{ jobSummary?: { jobId?: string; status?: string } }>(["amplify", "start-job", "--app-id", appId, "--branch-name", branchName, "--job-type", "RELEASE"]);
console.log(JSON.stringify({ appId, branchName, eventMode, expectedCommit, jobId: started.jobSummary?.jobId, status: started.jobSummary?.status }, null, 2));
