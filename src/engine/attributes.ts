/**
 * The 29 outfield attributes shared by every EA dataset we read, in a fixed
 * order. The slot-rating model's weight vectors are index-aligned with this.
 */
export const ATTRIBUTES = [
  "crossing", "finishing", "heading_accuracy", "short_passing", "volleys",
  "dribbling_stat", "curve", "fk_accuracy", "long_passing", "ball_control",
  "acceleration", "sprint_speed", "agility", "reactions", "balance",
  "shot_power", "jumping", "stamina", "strength", "long_shots",
  "aggression", "interceptions", "positioning", "vision", "penalties",
  "composure", "defensive_awareness", "standing_tackle", "sliding_tackle",
] as const;

export type AttributeName = (typeof ATTRIBUTES)[number];

/** Goalkeeping attributes, used for the GK slot only. */
export const GK_ATTRIBUTES = [
  "gk_diving", "gk_handling", "gk_kicking", "gk_positioning", "gk_reflexes",
] as const;
