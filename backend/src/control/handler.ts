import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { AmplifyClient, GetAppCommand, GetBranchCommand, GetJobCommand, StartJobCommand, UpdateBranchCommand } from "@aws-sdk/client-amplify";
import { z } from "zod";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { authenticate, requireAdminOnly } from "../regweek/auth.js";
import { errorResponse, jsonResponse } from "../regweek/responses.js";

const modeSchema = z.object({
  mode: z.enum(["registration", "competition", "concluded"]),
  expectedCommit: z.string().regex(/^[0-9a-f]{40}$/i),
  confirmation: z.string(),
  resultsCommitted: z.boolean().optional(),
});

function body(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body); }
  catch { throw new ApiError(400, "VALIDATION_ERROR", "Malformed JSON body"); }
}

function client(): AmplifyClient { return new AmplifyClient({ region: config.amplifyControl.region }); }

async function status() {
  const { appId, branchName } = config.amplifyControl;
  const branch = (await client().send(new GetBranchCommand({ appId, branchName }))).branch;
  if (!branch?.activeJobId) throw new ApiError(409, "CONFLICT", "Amplify branch has no active deployment");
  const job = (await client().send(new GetJobCommand({ appId, branchName, jobId: branch.activeJobId }))).job?.summary;
  const app = (await client().send(new GetAppCommand({ appId }))).app;
  const variables = { ...(app?.environmentVariables ?? {}), ...(branch.environmentVariables ?? {}) };
  return { appId, branchName, activeJobId: branch.activeJobId, commitId: job?.commitId ?? null, jobStatus: job?.status ?? null, mode: variables.VITE_EVENT_MODE ?? null };
}

async function deploy(input: z.infer<typeof modeSchema>) {
  const current = await status();
  if (current.commitId !== input.expectedCommit) throw new ApiError(409, "CONFLICT", "Deployed commit changed; refresh before deploying mode");
  const expectedConfirmation = `DEPLOY_${input.mode.toUpperCase()}`;
  if (input.confirmation !== expectedConfirmation) throw new ApiError(400, "VALIDATION_ERROR", `confirmation must be ${expectedConfirmation}`);
  if (input.mode === "concluded" && !input.resultsCommitted) throw new ApiError(400, "VALIDATION_ERROR", "Concluded mode requires a committed results.json artifact");
  if (current.mode === input.mode) throw new ApiError(409, "CONFLICT", `Already deployed in ${input.mode} mode`);

  const { appId, branchName } = config.amplifyControl;
  const app = (await client().send(new GetAppCommand({ appId }))).app;
  const branch = (await client().send(new GetBranchCommand({ appId, branchName }))).branch;
  const environmentVariables = { ...(app?.environmentVariables ?? {}), ...(branch?.environmentVariables ?? {}), VITE_EVENT_MODE: input.mode };
  await client().send(new UpdateBranchCommand({ appId, branchName, environmentVariables }));
  const started = await client().send(new StartJobCommand({ appId, branchName, jobType: "RELEASE" }));
  return { ...current, requestedMode: input.mode, jobId: started.jobSummary?.jobId ?? null, jobStatus: started.jobSummary?.status ?? null };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    // HTTP API commonly normalizes header names, but the event contract permits
    // either casing. Keep this consistent with the registration Lambda so a
    // valid browser token can never be mistaken for an absent one.
    const user = await authenticate(event.headers.authorization ?? event.headers.Authorization);
    requireAdminOnly(user);
    if (event.requestContext.http.method === "GET" && event.rawPath === "/deployment/status") return jsonResponse(200, await status());
    if (event.requestContext.http.method === "POST" && event.rawPath === "/deployment/mode") {
      const parsed = modeSchema.safeParse(body(event));
      if (!parsed.success) throw new ApiError(400, "VALIDATION_ERROR", "Invalid deployment request");
      return jsonResponse(202, await deploy(parsed.data));
    }
    throw new ApiError(404, "NOT_FOUND", "Route not found");
  } catch (error) { return errorResponse(error); }
}
