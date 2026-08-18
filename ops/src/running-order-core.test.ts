import { strict as assert } from "node:assert";
import test from "node:test";
import { drawRounds, shuffle, type Entrant, type RandomIndex } from "./running-order-core.js";

const team = (id: string): Entrant => ({ competitorId: id, teamName: `Team ${id}` });
const field = ["a", "b", "c", "d", "e"].map(team);
/** Deterministic stand-in for randomInt, cycling so orders actually vary. */
const cyclingRandom = (): RandomIndex => { let n = 0; return (bound) => (n++ * 7 + 3) % bound; };

test("every team runs exactly once in each round", () => {
  const rounds = drawRounds(field, 3, cyclingRandom());
  assert.equal(rounds.length, 3);
  for (const round of rounds) {
    assert.deepEqual(
      round.map((entrant) => entrant.competitorId).sort(),
      ["a", "b", "c", "d", "e"],
    );
  }
});

test("nobody closes one round and opens the next", () => {
  for (let seed = 0; seed < 200; seed++) {
    let n = seed;
    const rounds = drawRounds(field, 3, (bound) => { n = (n * 1103515245 + 12345) >>> 0; return n % bound; });
    for (let index = 1; index < rounds.length; index++) {
      const closed = rounds[index - 1].at(-1)!.competitorId;
      const opened = rounds[index][0].competitorId;
      assert.notEqual(opened, closed, `seed ${seed}: ${closed} ran last then first`);
    }
  }
});

test("a single entrant is drawn without looping on the impossible constraint", () => {
  const rounds = drawRounds([team("solo")], 3, cyclingRandom());
  assert.deepEqual(rounds.map((round) => round.map((entrant) => entrant.competitorId)), [["solo"], ["solo"], ["solo"]]);
});

test("shuffle keeps the field intact and can reorder it", () => {
  const random = cyclingRandom();
  const once = shuffle(field, random);
  assert.deepEqual(once.map((entrant) => entrant.competitorId).sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(once.length, field.length);
  // Fixed input, fixed random: a draw is reproducible.
  assert.deepEqual(shuffle(field, cyclingRandom()), shuffle(field, cyclingRandom()));
});
