/**
 * Draws a random running order for the qualifying round.
 *
 * The console has no running-order concept in ROUND_1 — every inspected team
 * is eligible and the operator assigns whoever is next — so the order is a
 * paper artefact produced once, before the round, and read from. Randomising it
 * removes the appearance of favour in who runs first, which is the whole point.
 *
 * Read-only: this writes nothing to the table. Re-running produces a different
 * order, so draw once and keep the output — it is the record of the draw.
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

const rows: Array<{ category: string; position: number; teamName: string; competitorId: string }> = [];
for (const category of [...new Set(eligible.map((team) => team.category))].sort()) {
  const drawn = eligible.filter((team) => team.category === category);
  // Fisher-Yates: every ordering equally likely, which a sort-by-random is not.
  for (let index = drawn.length - 1; index > 0; index--) {
    const swap = random(index + 1);
    [drawn[index], drawn[swap]] = [drawn[swap], drawn[index]];
  }
  console.log("");
  console.log(`${category} — ${drawn.length} teams`);
  drawn.forEach((team, index) => {
    console.log(`${String(index + 1).padStart(3)}. ${team.teamName}`);
    rows.push({ category, position: index + 1, teamName: team.teamName, competitorId: team.competitorId });
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
  const csv = ["category,position,teamName,competitorId"]
    .concat(rows.map((row) => [row.category, row.position, `"${row.teamName.replace(/"/g, '""')}"`, row.competitorId].join(",")))
    .join("\n");
  await writeFile(csvPath, `${csv}\n`, "utf8");
  console.log(`CSV written to ${csvPath}`);
}
