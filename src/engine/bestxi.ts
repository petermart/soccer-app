/**
 * Picks the strongest legal XI a squad can field.
 *
 * Used for two things: rating computer opposition on exactly the same scale
 * as the player's drafted side, and the "auto-fill" convenience in the draft.
 */
import { slotsOf } from "./formations.ts";
import { canPlaySlot, rateTeam, ratingInSlot, type Pick, type RatingLens, type TeamRating } from "./ratings.ts";
import type { ClubSeason, PlayerSeason } from "./types.ts";

/**
 * Greedy fill, most-constrained slot first. Not a true optimum, but it is
 * stable, fast, and picks the obvious XI a human would.
 */
export function bestXi(
  players: PlayerSeason[],
  formation: string,
  lens: RatingLens,
  meta: { club: string; season: string } = { club: "", season: "" },
): Pick[] {
  const slots = slotsOf(formation);
  const taken = new Set<number>();
  const picks: Pick[] = [];

  // Keepers first: only one player in the squad can fill that slot.
  const order = [...slots].sort((a, b) => Number(b.slot === "GK") - Number(a.slot === "GK"));

  for (const slot of order) {
    let best: { player: PlayerSeason; rating: number } | null = null;
    for (const p of players) {
      if (taken.has(p.pid) || !canPlaySlot(p, slot.slot)) continue;
      const rating = ratingInSlot(p, slot.slot, lens);
      if (!best || rating > best.rating) best = { player: p, rating };
    }
    if (!best) continue;
    taken.add(best.player.pid);
    picks.push({
      player: best.player,
      slot: slot.slot,
      slotIndex: slot.index,
      club: meta.club,
      season: meta.season,
    });
  }

  return picks.sort((a, b) => a.slotIndex - b.slotIndex);
}

/** Rates a club-season by the XI it would actually put out. */
export function rateClubSeason(cs: ClubSeason, formation = "4-3-3"): TeamRating {
  return rateTeam(bestXi(cs.players, formation, "season", cs), "season");
}
