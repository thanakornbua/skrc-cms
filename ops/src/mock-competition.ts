import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomInt } from "node:crypto";

const port = Number(process.env.MOCK_PORT ?? 3000);
const category = "Line Tracing - Open";
type Stage = "ROUND_1" | "BEST_OF_4" | "BEST_OF_2" | "THE_BEST";
const stages: Stage[] = ["ROUND_1", "BEST_OF_4", "BEST_OF_2", "THE_BEST"];
let activeStage: Stage = "ROUND_1";
const runDurationMs = 5_000;

interface Run { runId: string; status: "COMPLETE"; elapsedMs: number; minTimeMs: number; maxTimeMs: number; stage: Stage }
interface Penalty { SK: string; ruleId: string; label: string; penaltyMs: number; stage: Stage; at: string; revocation: { reason: string; byUser: string; at: string } | null }
interface Team { competitorId: string; teamName: string; name: string; runs: Run[]; penalties: Penalty[]; status: "INSPECTED" | "RUN_COMPLETE" }
type BracketRound = "QUARTERFINAL" | "SEMIFINAL" | "FINAL" | "THIRD_PLACE";
interface BracketMatch {
  matchId: string;
  round: BracketRound;
  order: number;
  teamAId: string;
  teamBId: string;
  startsFirstId: string;
  winnerId: string | null;
}
interface Bracket {
  drawnAt: string;
  positions: Array<{ position: number; competitorId: string; teamName: string }>;
  matches: BracketMatch[];
}
interface Lane {
  laneId: string;
  state: "IDLE" | "ASSIGNED" | "ARMED" | "RUNNING";
  competitorId: string | null;
  deviceId: string;
  armedBy: string | null;
  runStartedAt: string | null;
  updatedAt: string;
  transitionAt: number;
}

const teams: Team[] = [
  ["C-0001", "Pink Circuit", "Narin S."],
  ["C-0002", "Blue Velocity", "Pimchanok K."],
  ["C-0003", "Chompoo Trackers", "Thanawat P."],
  ["C-0004", "SuanKularb Robotics", "Krit N."],
  ["C-0005", "Rose Line Lab", "Araya T."],
  ["C-0006", "Bangkok Bit Racers", "Phuwin J."],
  ["C-0007", "Royal Track", "Napatsorn V."],
  ["C-0008", "Robot Garden", "Chanin R."],
].map(([competitorId, teamName, name], index) => ({
  competitorId, teamName, name, runs: [], status: "INSPECTED" as const,
  // Rule 7.3(2): the first two unauthorized interventions in the same attempt each
  // cost 5s; a third ends the run outright (an attempt-ending event, not a further
  // penalty). No other act carries a fixed time penalty under the rules — restarts
  // up to three per attempt (Rule 5.3) are unpenalized by design.
  penalties: index === 0 ? [{
    SK: "PENALTY#seed#unauthorized-intervention", ruleId: "unauthorized-intervention",
    label: "Unauthorized intervention (Rule 7.3)",
    penaltyMs: 5_000, stage: "ROUND_1", at: new Date().toISOString(), revocation: null,
  }] : [],
}));

const penaltyRules = [
  { ruleId: "unauthorized-intervention", label: "Unauthorized intervention (Rule 7.3)", penaltyMs: 5_000, active: true, kind: "INTERVENTION" as const },
];

const queue = Array.from({ length: 3 }, () => teams.map((team) => team.competitorId)).flat();
let eligibleIds = teams.map((team) => team.competitorId);
let bracket: Bracket | null = null;
let phase: "OPEN" | "CONCLUDED" = "OPEN";
const now = Date.now();
const lanes: Lane[] = [
  { laneId: "1", state: "RUNNING", competitorId: queue.shift()!, deviceId: "mock-esp32-lane1", armedBy: "mock-admin", runStartedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), transitionAt: now + runDurationMs },
  { laneId: "2", state: "ARMED", competitorId: queue.shift()!, deviceId: "mock-esp32-lane2", armedBy: "mock-admin", runStartedAt: null, updatedAt: new Date(now).toISOString(), transitionAt: now + 4_000 },
];

let runNumber = 0;
function team(id: string | null): Team | undefined { return teams.find((item) => item.competitorId === id); }

function cycleLane(lane: Lane, timestamp: number): void {
  if (timestamp < lane.transitionAt) return;
  if (lane.state === "ARMED") {
    lane.state = "RUNNING";
    lane.runStartedAt = new Date(timestamp).toISOString();
    lane.updatedAt = lane.runStartedAt;
    lane.transitionAt = timestamp + runDurationMs;
    return;
  }
  if (lane.state === "RUNNING") {
    const competitor = team(lane.competitorId);
    if (competitor) {
      runNumber += 1;
      const elapsedMs = 8_700 + ((runNumber * 1_379 + Number(lane.laneId) * 613) % 7_800);
      competitor.runs.push({ runId: `mock-${runNumber}`, status: "COMPLETE", elapsedMs, minTimeMs: 1_000, maxTimeMs: 180_000, stage: activeStage });
      if (runNumber % 4 === 0) competitor.penalties.push({
        SK: `PENALTY#${new Date().toISOString()}#unauthorized-intervention`,
        ruleId: "unauthorized-intervention", label: "Unauthorized intervention (Rule 7.3)", penaltyMs: 5_000,
        stage: activeStage, at: new Date().toISOString(), revocation: null,
      });
      competitor.status = "RUN_COMPLETE";
    }
    lane.competitorId = queue.shift() ?? null;
    lane.state = lane.competitorId ? "ARMED" : "IDLE";
    lane.runStartedAt = null;
    lane.updatedAt = new Date(timestamp).toISOString();
    lane.transitionAt = timestamp + 1_500;
  }
}

setInterval(() => lanes.forEach((lane) => cycleLane(lane, Date.now())), 250).unref();

function rankingRows() {
  const scoringMode = "TIME_AVERAGE" as const;
  return teams
    .filter((item) => eligibleIds.includes(item.competitorId))
    .filter((item) => item.runs.some((run) => run.stage === activeStage))
    .map((item) => ({
      item,
      stageRuns: item.runs.filter((run) => run.stage === activeStage).sort((a, b) => a.elapsedMs - b.elapsedMs),
      penalty: item.penalties.filter((entry) => entry.stage === activeStage && !entry.revocation).reduce((sum, entry) => sum + entry.penaltyMs, 0),
    }))
    .map(({ item, stageRuns, penalty }) => {
      const best = stageRuns[0].elapsedMs;
      const aggregate = scoringMode === "TIME_AVERAGE"
        ? stageRuns.slice(0, 2).reduce((sum, run) => sum + run.elapsedMs, 0) / Math.min(stageRuns.length, 2)
        : best;
      return { item, best, aggregate, penalty, scoringMode };
    })
    .sort((a, b) => (a.aggregate + a.penalty) - (b.aggregate + b.penalty));
}

function randomBracket(qualifiedIds: string[]) {
  const shuffled = [...qualifiedIds];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = randomInt(index + 1);
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  const positions = shuffled.map((competitorId, index) => ({
    position: index + 1,
    competitorId,
    teamName: team(competitorId)?.teamName ?? competitorId,
  }));
  return {
    drawnAt: new Date().toISOString(),
    positions,
    matches: Array.from({ length: 4 }, (_, index) => makeMatch(
      `QF${index + 1}`, "QUARTERFINAL", index + 1,
      positions[index * 2].competitorId, positions[index * 2 + 1].competitorId
    )),
  };
}

function makeMatch(matchId: string, round: BracketRound, order: number, teamAId: string, teamBId: string): BracketMatch {
  return { matchId, round, order, teamAId, teamBId, startsFirstId: randomInt(2) === 0 ? teamAId : teamBId, winnerId: null };
}

function matchQueue(matches: BracketMatch[]): string[] {
  return matches.flatMap((match) => {
    const first = match.startsFirstId;
    const second = first === match.teamAId ? match.teamBId : match.teamAId;
    return [first, second, second, first, first, second];
  });
}

function teamStageResult(competitorId: string, selectedStage: Stage) {
  const competitor = team(competitorId)!;
  const runs = competitor.runs.filter((run) => run.stage === selectedStage).sort((a, b) => a.elapsedMs - b.elapsedMs);
  if (runs.length < 3) return null;
  const average = Math.ceil((runs[0].elapsedMs + runs[1].elapsedMs) / 2);
  const penalty = competitor.penalties.filter((entry) => entry.stage === selectedStage && !entry.revocation).reduce((sum, entry) => sum + entry.penaltyMs, 0);
  return { average, penalty, final: average + penalty };
}

function settleMatches(round: BracketRound, selectedStage: Stage): BracketMatch[] {
  if (!bracket) return [];
  const matches = bracket.matches.filter((match) => match.round === round);
  for (const match of matches) {
    const a = teamStageResult(match.teamAId, selectedStage);
    const b = teamStageResult(match.teamBId, selectedStage);
    if (a && b) match.winnerId = a.final <= b.final ? match.teamAId : match.teamBId;
  }
  return matches;
}

function publicBracket() {
  if (!bracket) return null;
  return {
    category,
    drawnAt: bracket.drawnAt,
    positions: bracket.positions.map(({ position, teamName }) => ({ position, teamName })),
    matches: bracket.matches.map((match) => {
      const stageForRound: Stage = match.round === "QUARTERFINAL" ? "BEST_OF_4" : match.round === "SEMIFINAL" ? "BEST_OF_2" : "THE_BEST";
      const a = teamStageResult(match.teamAId, stageForRound);
      const b = teamStageResult(match.teamBId, stageForRound);
      return {
        matchId: match.matchId, round: match.round, order: match.order,
        teamA: { teamName: team(match.teamAId)?.teamName ?? match.teamAId, finalTimeMs: a?.final ?? null },
        teamB: { teamName: team(match.teamBId)?.teamName ?? match.teamBId, finalTimeMs: b?.final ?? null },
        startsFirst: team(match.startsFirstId)?.teamName ?? match.startsFirstId,
        winnerTeamName: match.winnerId ? team(match.winnerId)?.teamName ?? match.winnerId : null,
        status: match.winnerId ? "COMPLETE" : "PENDING",
      };
    }),
  };
}

function scoreboard() {
  const rankedTeams = rankingRows();
  const scoringMode = "TIME_AVERAGE" as const;
  return {
    state: phase === "CONCLUDED" ? "FINAL" : "PROVISIONAL",
    activeStage,
    brackets: bracket ? [publicBracket()] : [],
    categories: [{
      category,
      stage: activeStage,
      scoringMode,
      ranked: rankedTeams.map(({ item, best, aggregate, penalty }, index) => ({
        rank: index + 1, teamName: item.teamName, stage: activeStage, scoringMode,
        completedLap: true, lapTimeMs: best, furthestCheckpoint: 3,
        aggregateTimeMs: aggregate, penaltyTimeMs: penalty, finalTimeMs: aggregate + penalty,
      })),
      unranked: teams.filter((item) => eligibleIds.includes(item.competitorId) && !item.runs.some((run) => run.stage === activeStage)).map((item) => ({ teamName: item.teamName })),
      disqualified: [],
    }],
  };
}

function competitorDetail(competitor: Team) {
  const currentLane = lanes.find((lane) => lane.competitorId === competitor.competitorId);
  const activeRuns = competitor.runs.filter((run) => run.stage === activeStage);
  const best = activeRuns.length ? Math.min(...activeRuns.map((run) => run.elapsedMs)) : null;
  const penaltyTimeMs = competitor.penalties.filter((entry) => entry.stage === activeStage && !entry.revocation).reduce((sum, entry) => sum + entry.penaltyMs, 0);
  return {
    competitorId: competitor.competitorId,
    name: competitor.name,
    teamName: competitor.teamName,
    category,
    activeStage,
    status: competitor.status,
    checkedInAt: new Date(Date.now() - 3_600_000).toISOString(),
    inspectedAt: new Date(Date.now() - 2_700_000).toISOString(),
    disqualified: { bool: false, reason: null, byUser: null, at: null },
    lane: currentLane ? { laneId: currentLane.laneId, state: currentLane.state } : null,
    runs: competitor.runs,
    penalties: competitor.penalties,
    aggregateTimeMs: best,
    penaltyTimeMs,
    finalTimeMs: best === null ? null : best + penaltyTimeMs,
    rank: scoreboard().categories[0].ranked.find((row) => row.teamName === competitor.teamName)?.rank ?? null,
  };
}

function json(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { return {}; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,x-device-key",
      "access-control-max-age": "300",
    });
    return res.end();
  }
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { status: "ok", version: "interactive-mock" });
  if (req.method === "GET" && url.pathname === "/auth/me") return json(res, 200, { sub: "mock-admin", role: "admin", competitorId: "C-0001" });
  if (req.method === "GET" && url.pathname === "/public/scoreboard") return json(res, 200, scoreboard());
  if (req.method === "GET" && url.pathname === "/admin/lanes") return json(res, 200, { lanes: lanes.map(({ transitionAt, ...lane }) => lane) });
  if (req.method === "GET" && url.pathname === "/admin/config/penalties") return json(res, 200, { rules: penaltyRules });
  if (req.method === "GET" && url.pathname === "/admin/config/categories") return json(res, 200, { categories: [{ category, minTimeMs: 1_000, maxTimeMs: 180_000, stageMaxTimeMs: { ROUND_1: 180_000, BEST_OF_4: 180_000, BEST_OF_2: 180_000, THE_BEST: 180_000 }, stageMaxAttempts: { ROUND_1: 3, BEST_OF_4: 3, BEST_OF_2: 3, THE_BEST: 3 } }] });
  if (req.method === "GET" && url.pathname === "/admin/competition/state") return json(res, 200, { phase, activeStage, eligibleCompetitorIds: eligibleIds });

  if (req.method === "POST" && url.pathname === "/admin/competition/advance") {
    const nextStage = stages[stages.indexOf(activeStage) + 1];
    if (!nextStage) return json(res, 409, { error: { code: "CONFLICT", message: "The Best is the final competition stage" } });
    const previousRanking = rankingRows().map((row) => row.item.competitorId);
    const stageComplete = eligibleIds.every((competitorId) => team(competitorId)!.runs.filter((run) => run.stage === activeStage).length >= 3);
    if (!stageComplete) return json(res, 409, { error: { code: "CONFLICT", message: "Every eligible team must complete three attempts before advancing" } });
    let nextMatches: BracketMatch[];
    if (activeStage === "ROUND_1") {
      eligibleIds = previousRanking.slice(0, 8);
      if (eligibleIds.length < 8) return json(res, 409, { error: { code: "CONFLICT", message: "Eight ranked teams are required for the bracket draw" } });
      bracket = randomBracket(eligibleIds);
      nextMatches = bracket.matches.filter((match) => match.round === "QUARTERFINAL");
    } else if (activeStage === "BEST_OF_4") {
      const quarterfinals = settleMatches("QUARTERFINAL", "BEST_OF_4");
      if (quarterfinals.some((match) => !match.winnerId)) return json(res, 409, { error: { code: "CONFLICT", message: "Every quarterfinal must have a winner" } });
      const winners = quarterfinals.map((match) => match.winnerId!);
      nextMatches = [
        makeMatch("SF1", "SEMIFINAL", 1, winners[0], winners[1]),
        makeMatch("SF2", "SEMIFINAL", 2, winners[2], winners[3]),
      ];
      bracket!.matches.push(...nextMatches);
      eligibleIds = winners;
    } else {
      const semifinals = settleMatches("SEMIFINAL", "BEST_OF_2");
      if (semifinals.some((match) => !match.winnerId)) return json(res, 409, { error: { code: "CONFLICT", message: "Both semifinals must have winners" } });
      const winners = semifinals.map((match) => match.winnerId!);
      const losers = semifinals.map((match) => match.winnerId === match.teamAId ? match.teamBId : match.teamAId);
      nextMatches = [
        makeMatch("F", "FINAL", 1, winners[0], winners[1]),
        makeMatch("3P", "THIRD_PLACE", 1, losers[0], losers[1]),
      ];
      bracket!.matches.push(...nextMatches);
      eligibleIds = [...winners, ...losers];
    }
    activeStage = nextStage;
    queue.splice(0, queue.length, ...matchQueue(nextMatches));
    const changedAt = Date.now();
    for (const [index, lane] of lanes.entries()) {
      lane.competitorId = queue.shift() ?? null;
      lane.state = lane.competitorId ? "ARMED" : "IDLE";
      lane.runStartedAt = null;
      lane.updatedAt = new Date(changedAt).toISOString();
      lane.transitionAt = changedAt + 1_500 + index * 1_000;
    }
    for (const competitor of teams) competitor.status = "INSPECTED";
    return json(res, 200, { phase: "OPEN", activeStage, eligibleCompetitorIds: eligibleIds });
  }

  if (req.method === "POST" && url.pathname === "/admin/competition/conclude") {
    const stageComplete = activeStage === "THE_BEST" && eligibleIds.every((competitorId) => team(competitorId)!.runs.filter((run) => run.stage === "THE_BEST").length >= 3);
    if (!stageComplete) return json(res, 409, { error: { code: "CONFLICT", message: "Final and third-place teams must complete three attempts" } });
    settleMatches("FINAL", "THE_BEST");
    settleMatches("THIRD_PLACE", "THE_BEST");
    phase = "CONCLUDED";
    return json(res, 200, scoreboard());
  }

  const competitorMatch = url.pathname.match(/^\/competitors\/([^/]+)$/);
  if (req.method === "GET" && competitorMatch) {
    const competitor = team(decodeURIComponent(competitorMatch[1]));
    return competitor ? json(res, 200, competitorDetail(competitor)) : json(res, 404, { error: { code: "NOT_FOUND", message: "Mock competitor not found" } });
  }

  const laneMatch = url.pathname.match(/^\/admin\/lanes\/([^/]+)\/(assign|arm|reset)$/);
  if (req.method === "POST" && laneMatch) {
    const lane = lanes.find((item) => item.laneId === decodeURIComponent(laneMatch[1]));
    if (!lane) return json(res, 404, { error: { code: "NOT_FOUND", message: "Mock lane not found" } });
    const action = laneMatch[2];
    if (action === "reset") { lane.state = "IDLE"; lane.competitorId = null; lane.runStartedAt = null; }
    if (action === "assign") { const body = await readBody(req); lane.competitorId = String(body.competitorId ?? ""); lane.state = "ASSIGNED"; }
    if (action === "arm") { lane.state = "ARMED"; lane.armedBy = "mock-admin"; lane.transitionAt = Date.now() + 3_000; }
    lane.updatedAt = new Date().toISOString();
    return json(res, 200, { lane: { ...lane, transitionAt: undefined } });
  }

  const applyPenaltyMatch = url.pathname.match(/^\/committee\/competitors\/([^/]+)\/penalties$/);
  if (req.method === "POST" && applyPenaltyMatch) {
    const competitor = team(decodeURIComponent(applyPenaltyMatch[1]));
    const body = await readBody(req);
    const rule = penaltyRules.find((item) => item.ruleId === body.ruleId);
    if (!competitor || !rule) return json(res, 404, { error: { code: "NOT_FOUND", message: "Mock competitor or penalty rule not found" } });
    const at = new Date().toISOString();
    const penalty: Penalty = { SK: `PENALTY#${at}#${rule.ruleId}`, ruleId: rule.ruleId, label: rule.label, penaltyMs: rule.penaltyMs, stage: activeStage, at, revocation: null };
    competitor.penalties.push(penalty);
    return json(res, 201, penalty);
  }

  const revokePenaltyMatch = url.pathname.match(/^\/admin\/competitors\/([^/]+)\/penalties\/(.+)\/revoke$/);
  if (req.method === "POST" && revokePenaltyMatch) {
    const competitor = team(decodeURIComponent(revokePenaltyMatch[1]));
    const penalty = competitor?.penalties.find((item) => item.SK === decodeURIComponent(revokePenaltyMatch[2]));
    if (!penalty) return json(res, 404, { error: { code: "NOT_FOUND", message: "Mock penalty not found" } });
    const body = await readBody(req);
    penalty.revocation = { reason: String(body.reason ?? "Mock revocation"), byUser: "mock-admin", at: new Date().toISOString() };
    return json(res, 200, penalty);
  }

  // Timing-page demo mutations acknowledge the action; the cycling mock keeps
  // its deterministic in-memory fixture so refreshing always remains useful.
  if (["POST", "PUT", "PATCH"].includes(req.method ?? "")) return json(res, 200, { status: "MOCK_ACCEPTED" });
  return json(res, 404, { error: { code: "NOT_FOUND", message: "Mock route not found" } });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`SKRC competition mock listening on http://localhost:${port}`);
  console.log("Round 1 reset: eight teams, three attempts each, then a one-time random bracket draw.");
});
