/**
 * Draws the random running sequence for the qualifying round.
 *
 * Every team gets three attempts (D25, Rules 4.2(2)/4.5(1)), and the field runs
 * them a round at a time: everyone takes attempt 1, then everyone attempt 2,
 * then attempt 3. Each round is drawn separately, so no team is stuck running
 * first — or last — three times over, and every team has the rest of a round to
 * work on the robot before its next attempt.
 *
 * The console has no running-order concept in ROUND_1 — every inspected team is
 * eligible and the operator assigns whoever is next — so this sheet is a paper
 * artefact produced once, before the round, and read from.
 *
 * Read-only: this writes nothing to the table. Re-running produces a different
 * sequence, so draw once and keep the output — it is the record of the draw.
 *
 *   DYNAMO_TABLE   competition table (default: robo-compet)
 *   --seed <text>  reproducible order; prove the draw was not re-rolled by
 *                  publishing the seed alongside the order
 *   --csv <path>   also write the order as CSV for printing
 */
import { createHash, randomInt } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { drawRounds } from "./running-order-core.js";

const argv = process.argv.slice(2);
const valueOf = (flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const seed = valueOf("--seed");
const csvPath = valueOf("--csv");
const table = process.env.DYNAMO_TABLE ?? "robo-compet";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface Team { competitorId: string; teamName: string; category: string; status: string; disqualified: boolean }

const teams: Team[] = [];
let startKey: Record<string, unknown> | undefined;
do {
  const page = await ddb.send(new ScanCommand({ TableName: table, ExclusiveStartKey: startKey }));
  for (const item of page.Items ?? []) {
    if (String(item.PK).startsWith("COMP#") && item.SK === "PROFILE") {
      teams.push({
        competitorId: String(item.competitorId),
        teamName: String(item.teamName ?? ""),
        category: String(item.category ?? ""),
        status: String(item.status ?? ""),
        disqualified: Boolean((item.disqualified as { bool?: boolean } | undefined)?.bool),
      });
    }
  }
  startKey = page.LastEvaluatedKey;
} while (startKey);

// Same bar the console applies before a lane may be assigned (STATES.md): a
// team that has not passed inspection cannot run, so it cannot hold a slot.
const eligible = teams.filter((team) =>
  !team.disqualified && team.status !== "REGISTERED" && team.status !== "CHECKED_IN");

/**
 * With --seed the order is a pure function of the seed, so anyone holding it
 * can recompute the draw and see it was not run repeatedly until it looked
 * favourable. Without one it comes from the system CSPRNG.
 */
function makeRandom(): (bound: number) => number {
  if (seed === undefined) return (bound: number) => randomInt(bound);
  let counter = 0;
  return (bound: number) => {
    const digest = createHash("sha256").update(`${seed}:${counter++}`).digest();
    return digest.readUInt32BE(0) % bound;
  };
}
const random = makeRandom();

/** Rules 4.2(2)/4.5(1): three attempts per team, so three rounds of the field. */
const ROUNDS = 3;

const rows: Array<{ category: string; round: number; position: number; teamName: string; competitorId: string }> = [];

for (const category of [...new Set(eligible.map((team) => team.category))].sort()) {
  const entrants = eligible.filter((team) => team.category === category);
  drawRounds(entrants, ROUNDS, random).forEach((order, index) => {
    const round = index + 1;
    console.log("");
    console.log(`ROUND ${round} of ${ROUNDS}   (${category}${round === 1 ? `, ${entrants.length} teams` : ""})`);
    order.forEach((team, position) => {
      console.log(`${String(position + 1).padStart(3)}. ${team.teamName}`);
      rows.push({ category, round, position: position + 1, teamName: team.teamName, competitorId: team.competitorId });
    });
  });
}

console.log("");
console.log(`Drawn ${new Date().toISOString()}${seed === undefined ? "" : ` with seed "${seed}"`}`);
const skipped = teams.length - eligible.length;
if (skipped > 0) console.log(`${skipped} team(s) omitted: not inspected, or disqualified.`);
if (eligible.length === 0) console.log("No eligible teams found — has inspection been completed?");

if (csvPath) {
  // Competitor IDs are internal (Rule 10.1(3)); this file is for the operator
  // table, not the public screen.
  const csv = ["category,round,position,teamName,competitorId"]
    .concat(rows.map((row) => [row.category, row.round, row.position, `"${row.teamName.replace(/"/g, '""')}"`, row.competitorId].join(",")))
    .join("\n");
  await writeFile(csvPath, `${csv}\n`, "utf8");
  console.log(rows.length === 0
    ? `CSV written to ${csvPath} — headers only, no teams were drawn.`
    : `CSV written to ${csvPath} — ${rows.length} run slots.`);
}
