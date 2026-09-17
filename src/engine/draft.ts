/**
 * Draft state machine: spin for a club-season, take one player, fill the XI.
 *
 * Two modes, matching how these games are normally played:
 *   squad-first    spin a club, pick any player, choose where they slot in
 *   position-first pick an empty slot, then spin for a club to fill it
 */
import { slotsOf, type SquadSlot } from "./formations.ts";
import type { LeagueId } from "./leagues.ts";
import { canPlaySlot, ratingInSlot, type Pick, type RatingLens } from "./ratings.ts";
import { Rng } from "./rng.ts";
import type { ClubSeason, PlayerSeason, Slot } from "./types.ts";

export type Difficulty = "easy" | "normal" | "hard";
export type DraftMode = "squad" | "position";

export const REROLLS: Record<Difficulty, number> = { easy: 3, normal: 1, hard: 0 };

export interface DraftConfig {
  /** The single competition you draft from and play in. */
  league: LeagueId;
  /** Which real season of that league you drop into; null means random. */
  playSeason: string | null;
  formation: string;
  difficulty: Difficulty;
  mode: DraftMode;
  lens: RatingLens;
  showRatings: boolean;
  /** Inclusive season-label bounds, e.g. ["2016/17", "2022/23"]. */
  seasonRange: [string, string];
  /** One human can only appear once, even across clubs and seasons. */
  uniquePlayers: boolean;
  seed: string;
  teamName: string;
}

export interface DraftState {
  config: DraftConfig;
  slots: SquadSlot[];
  picks: (Pick | null)[];
  rerollsLeft: number;
  spinCount: number;
  /** Set in squad-first mode once a club has been spun. */
  currentClub: ClubSeason | null;
  /** Set in position-first mode once a slot has been chosen. */
  targetSlotIndex: number | null;
  done: boolean;
  history: { club: string; season: string; player: string; slot: Slot }[];
}

export function createDraft(config: DraftConfig): DraftState {
  const slots = slotsOf(config.formation);
  return {
    config,
    slots,
    picks: slots.map(() => null),
    rerollsLeft: REROLLS[config.difficulty],
    spinCount: 0,
    currentClub: null,
    targetSlotIndex: null,
    done: false,
    history: [],
  };
}

export const openSlots = (s: DraftState): SquadSlot[] =>
  s.slots.filter((slot) => s.picks[slot.index] === null);

export const isComplete = (s: DraftState): boolean => s.picks.every((p) => p !== null);

/** Players already used, so the same human cannot be drafted twice. */
function usedPlayerIds(s: DraftState): Set<number> {
  const ids = new Set<number>();
  for (const p of s.picks) if (p) ids.add(p.player.pid);
  return ids;
}

/** Club-seasons already spun, so the wheel does not repeat itself. */
function usedClubKeys(s: DraftState): Set<string> {
  const keys = new Set<string>();
  for (const p of s.picks) if (p) keys.add(`${p.club}:${p.season}`);
  return keys;
}

export function withinRange(cs: ClubSeason, range: [string, string]): boolean {
  return cs.season >= range[0] && cs.season <= range[1];
}

/**
 * Club-seasons the wheel may legally land on: in range, not already used, and
 * holding at least one unused player who can fill an open slot.
 */
export function eligibleClubSeasons(s: DraftState, pool: ClubSeason[]): ClubSeason[] {
  const used = usedPlayerIds(s);
  const usedClubs = usedClubKeys(s);
  const open = s.targetSlotIndex !== null
    ? [s.slots[s.targetSlotIndex]!]
    : openSlots(s);
  if (open.length === 0) return [];

  return pool.filter((cs) => {
    if (!withinRange(cs, s.config.seasonRange)) return false;
    if (usedClubs.has(`${cs.club}:${cs.season}`)) return false;
    return cs.players.some(
      (p) =>
        (!s.config.uniquePlayers || !used.has(p.pid)) &&
        open.some((slot) => canPlaySlot(p, slot.slot)),
    );
  });
}

export interface SpinOutcome {
  club: ClubSeason;
  /** Players from that club who can legally be taken right now. */
  choices: { player: PlayerSeason; slots: Slot[]; bestRating: number }[];
}

/** Spins the wheel. Uniform across eligible club-seasons, like the original. */
export function spin(s: DraftState, pool: ClubSeason[], rngOverride?: Rng): SpinOutcome {
  const eligible = eligibleClubSeasons(s, pool);
  if (eligible.length === 0) throw new Error("No eligible club-seasons left to spin");
  const rng = rngOverride ?? new Rng(`${s.config.seed}:spin:${s.spinCount}`);
  const club = rng.pick(eligible);
  s.spinCount++;
  s.currentClub = club;
  return { club, choices: choicesFor(s, club) };
}

export function choicesFor(s: DraftState, club: ClubSeason): SpinOutcome["choices"] {
  const used = usedPlayerIds(s);
  const open = s.targetSlotIndex !== null ? [s.slots[s.targetSlotIndex]!] : openSlots(s);

  return club.players
    .filter((p) => !s.config.uniquePlayers || !used.has(p.pid))
    .map((player) => {
      const slots = open.filter((o) => canPlaySlot(player, o.slot)).map((o) => o.slot);
      const unique = [...new Set(slots)];
      const bestRating = unique.length
        ? Math.max(...unique.map((sl) => ratingInSlot(player, sl, s.config.lens)))
        : 0;
      return { player, slots: unique, bestRating };
    })
    .filter((c) => c.slots.length > 0)
    .sort((a, b) => b.bestRating - a.bestRating);
}

/**
 * Players from a club who fit this formation but only in slots that are
 * already filled. Moving someone out of the way would free a place for them.
 */
export function blockedFor(s: DraftState, club: ClubSeason): { player: PlayerSeason; slots: Slot[] }[] {
  const used = usedPlayerIds(s);
  const takeable = new Set(choicesFor(s, club).map((c) => c.player.pid));
  const filled = s.slots.filter((slot) => s.picks[slot.index] !== null);
  return club.players
    .filter((p) => !takeable.has(p.pid) && (!s.config.uniquePlayers || !used.has(p.pid)))
    .map((player) => ({
      player,
      slots: [...new Set(filled.filter((f) => canPlaySlot(player, f.slot)).map((f) => f.slot))],
    }))
    .filter((b) => b.slots.length > 0);
}

/**
 * Where an already-drafted player could go instead: any empty slot they can
 * play, or a filled slot whose occupant can play theirs in return.
 */
export function moveTargets(s: DraftState, fromIndex: number): number[] {
  const pick = s.picks[fromIndex];
  if (!pick) return [];
  const from = s.slots[fromIndex]!;
  return s.slots
    .filter((to) => {
      if (to.index === fromIndex || !canPlaySlot(pick.player, to.slot)) return false;
      const other = s.picks[to.index];
      return !other || canPlaySlot(other.player, from.slot);
    })
    .map((to) => to.index);
}

/** Moves a drafted player to another slot, swapping if it is occupied. */
export function movePick(s: DraftState, fromIndex: number, toIndex: number): DraftState {
  if (!moveTargets(s, fromIndex).includes(toIndex)) {
    const who = s.picks[fromIndex]?.player.name ?? "Nobody";
    throw new Error(`${who} cannot move to ${s.slots[toIndex]?.slot ?? "that slot"}`);
  }
  const moving = s.picks[fromIndex]!;
  const other = s.picks[toIndex];
  s.picks[toIndex] = { ...moving, slot: s.slots[toIndex]!.slot, slotIndex: toIndex };
  s.picks[fromIndex] = other
    ? { ...other, slot: s.slots[fromIndex]!.slot, slotIndex: fromIndex }
    : null;
  // Position-first: a target that just got filled is no longer a target.
  if (s.targetSlotIndex !== null && s.picks[s.targetSlotIndex]) s.targetSlotIndex = null;
  s.done = isComplete(s);
  return s;
}

/** Spends a reroll to spin again. Returns null when none are left. */
export function reroll(s: DraftState, pool: ClubSeason[]): SpinOutcome | null {
  if (s.rerollsLeft <= 0) return null;
  s.rerollsLeft--;
  return spin(s, pool, new Rng(`${s.config.seed}:reroll:${s.spinCount}:${s.rerollsLeft}`));
}

/** Commits a player into a slot. Throws if the move is not legal. */
export function draftPlayer(s: DraftState, player: PlayerSeason, slotIndex: number): DraftState {
  const club = s.currentClub;
  if (!club) throw new Error("Spin a club before drafting");
  const slot = s.slots[slotIndex];
  if (!slot) throw new Error(`No slot at index ${slotIndex}`);
  if (s.picks[slotIndex]) throw new Error(`${slot.slot} is already filled`);
  if (!canPlaySlot(player, slot.slot)) {
    throw new Error(`${player.name} cannot play ${slot.slot}`);
  }
  if (s.config.uniquePlayers && usedPlayerIds(s).has(player.pid)) {
    throw new Error(`${player.name} is already in the XI`);
  }

  s.picks[slotIndex] = {
    player, slot: slot.slot, slotIndex, club: club.club, season: club.season,
  };
  s.history.push({ club: club.club, season: club.season, player: player.name, slot: slot.slot });
  s.currentClub = null;
  s.targetSlotIndex = null;
  s.done = isComplete(s);
  return s;
}

/** Position-first mode: choose which empty slot the next spin must fill. */
export function chooseSlot(s: DraftState, slotIndex: number): DraftState {
  if (s.picks[slotIndex]) throw new Error("That slot is already filled");
  s.targetSlotIndex = slotIndex;
  s.currentClub = null;
  return s;
}

export const completedPicks = (s: DraftState): Pick[] =>
  s.picks.filter((p): p is Pick => p !== null);
