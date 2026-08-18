/**
 * Pure draw logic for the qualifying running sequence.
 *
 * Kept apart from the script's table reads and printing so the properties that
 * matter — every team appears exactly once per round, and nobody closes one
 * round then opens the next — are testable without AWS.
 */
export interface Entrant { competitorId: string; teamName: string }

/** Returns an index in [0, bound). Injected so a draw can be reproduced. */
export type RandomIndex = (bound: number) => number;

export function shuffle<T>(items: T[], random: RandomIndex): T[] {
  const order = [...items];
  // Fisher-Yates: every ordering equally likely, which a sort-by-random is not.
  for (let index = order.length - 1; index > 0; index--) {
    const swap = random(index + 1);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

/**
 * One independent draw per round.
 *
 * Whoever closed a round does not open the next: back-to-back attempts leave no
 * time to work on the robot, which is the advantage this round-at-a-time format
 * exists to spread evenly. With a single entrant the constraint is impossible
 * and is dropped rather than looped over forever.
 */
export function drawRounds(entrants: Entrant[], rounds: number, random: RandomIndex): Entrant[][] {
  const drawn: Entrant[][] = [];
  let previousLast: string | null = null;
  for (let round = 0; round < rounds; round++) {
    const order = shuffle(entrants, random);
    if (order.length > 1 && previousLast !== null && order[0].competitorId === previousLast) {
      const swapWith = 1 + random(order.length - 1);
      [order[0], order[swapWith]] = [order[swapWith], order[0]];
    }
    previousLast = order[order.length - 1]?.competitorId ?? null;
    drawn.push(order);
  }
  return drawn;
}
