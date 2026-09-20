import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  blockedFor, choicesFor, completedPicks, createDraft, draftPlayer, eligibleClubSeasons,
  movePick, moveTargets, reroll, spin, type DraftConfig, type DraftState,
} from "../engine/draft.ts";
import type { SquadSlot } from "../engine/formations.ts";
import { LEAGUES } from "../engine/leagues.ts";
import { playableSlots, rateTeam, ratingInSlot, slotNamesFor, type Pick } from "../engine/ratings.ts";
import type { ClubSeason, PlayerSeason, Slot } from "../engine/types.ts";
import { Pitch } from "./Pitch.tsx";
import { SpinWheel } from "./icons.tsx";

type Sort = "rating" | "position" | "name";

export interface DraftProps {
  config: DraftConfig;
  pool: ClubSeason[];
  onComplete: (picks: Pick[]) => void;
  onRestart: () => void;
}

export function Draft({ config, pool, onComplete, onRestart }: DraftProps) {
  const [state, setState] = useState<DraftState>(() => createDraft(config));
  const [spinning, setSpinning] = useState(false);
  const [reelClub, setReelClub] = useState<string | null>(null);
  const [pending, setPending] = useState<{ player: PlayerSeason; slots: Slot[] } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("rating");
  const [error, setError] = useState<string | null>(null);
  const spinTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const bump = useCallback(() => setState((s) => ({ ...s })), []);

  useEffect(() => () => { if (spinTimer.current) clearInterval(spinTimer.current); }, []);

  const filled = completedPicks(state);

  // `state.picks` is mutated in place, so its identity never changes. Key the
  // memo on a signature of who is drafted and where.
  const pickSignature = state.picks.map((p) => (p ? p.player.pid : 0)).join(",");

  const eligible = useMemo(
    () => eligibleClubSeasons(state, pool),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickSignature, state.targetSlotIndex, pool],
  );
  const ratings = useMemo(
    () => rateTeam(filled, config.lens).perSlot,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickSignature, config.lens],
  );
  const running = filled.length >= 3 ? rateTeam(filled, config.lens) : null;

  /** Runs the reel animation, then commits the real spin result. */
  const doSpin = (fn: () => ReturnType<typeof spin> | null) => {
    if (spinning || eligible.length === 0) return;
    setError(null);
    setMoving(null);
    setSpinning(true);

    const names = eligible.map((c) => c.club);
    spinTimer.current = setInterval(() => {
      setReelClub(names[Math.floor(Math.random() * names.length)] ?? null);
    }, 65);

    setTimeout(() => {
      if (spinTimer.current) clearInterval(spinTimer.current);
      spinTimer.current = null;
      setSpinning(false);
      setReelClub(null);
      try {
        const outcome = fn();
        if (!outcome) setError("No re-rolls left.");
        bump();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 900);
  };

  const choices = state.currentClub ? choicesFor(state, state.currentClub) : [];
  const blocked = state.currentClub ? blockedFor(state, state.currentClub) : [];

  const sorted = useMemo(() => {
    const list = choices.slice();
    if (sort === "position") return list.sort((a, b) => (a.slots[0] ?? "").localeCompare(b.slots[0] ?? "") || b.bestRating - a.bestRating);
    if (sort === "name") return list.sort((a, b) => a.player.name.localeCompare(b.player.name));
    return list.sort((a, b) => b.bestRating - a.bestRating);
  }, [choices, sort]);

  const take = (player: PlayerSeason, slots: Slot[]) => {
    setMoving(null);
    const open = state.slots.filter((s) => state.picks[s.index] === null && slots.includes(s.slot));
    if (open.length === 0) return;
    if (open.length === 1) {
      commit(player, open[0]!.index);
      return;
    }
    setPending({ player, slots });
  };

  const commit = (player: PlayerSeason, slotIndex: number) => {
    try {
      draftPlayer(state, player, slotIndex);
      setPending(null);
      setError(null);
      if (state.done) {
        onComplete(completedPicks(state));
        return;
      }
      bump();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const targets = useMemo(
    () => (moving === null ? new Set<number>() : new Set(moveTargets(state, moving))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moving, pickSignature],
  );

  const onSlotClick = (index: number) => {
    if (pending) { commit(pending.player, index); return; }

    if (moving !== null) {
      if (index !== moving && targets.has(index)) {
        try {
          movePick(state, moving, index);
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
      setMoving(null);
      bump();
      return;
    }

    if (state.picks[index]) {
      // Pick a drafted player up so they can be moved somewhere else.
      if (moveTargets(state, index).length === 0) {
        setError(`${state.picks[index]!.player.name} has nowhere else they can play right now.`);
        return;
      }
      setError(null);
      setMoving(index);
      return;
    }

    if (config.mode === "position") {
      state.targetSlotIndex = index;
      state.currentClub = null;
      bump();
    }
  };

  const cfg = LEAGUES[config.league];
  const openCount = state.picks.filter((p) => p === null).length;

  // Slots the pending player could take, or where a picked-up player can go.
  const highlight = useMemo(() => {
    if (moving !== null) return targets;
    if (!pending) return undefined;
    return new Set(
      state.slots.filter((s) => state.picks[s.index] === null && pending.slots.includes(s.slot)).map((s) => s.index),
    );
  }, [pending, moving, targets, state.slots, state.picks]);

  const movingPick = moving !== null ? state.picks[moving] : null;

  return (
    <div>
      <div className="draft-head">
        <div>
          <div className="progress-pills" aria-label={`${11 - openCount} of 11 drafted`}>
            {state.slots.map((s) => (
              <i key={s.index} className={state.picks[s.index] ? "on" : ""} />
            ))}
          </div>
          <div className="meta-line" style={{ marginTop: 8 }} data-testid="draft-meta">
            <b>{config.formation}</b> · {cfg.country} · <span data-testid="open-count">{openCount}</span> slot{openCount === 1 ? "" : "s"} left
            {running && <> · rated <b>{running.overall.toFixed(1)}</b></>}
          </div>
        </div>
        <div className="topbar-actions">
          <span className="meta-line">Re-rolls <b>{state.rerollsLeft}</b></span>
          <button className="btn" onClick={onRestart}>↺ Restart</button>
        </div>
      </div>

      <div className="draft-grid">
        <div>
          <Pitch
            slots={state.slots}
            picks={state.picks}
            ratings={ratings}
            showRatings={config.showRatings}
            highlight={highlight}
            targetIndex={state.targetSlotIndex}
            movingIndex={moving}
            onSlotClick={onSlotClick}
          />
          <p className="field-note pitch-hint" data-testid="pitch-hint">
            {movingPick
              ? <>Moving <b>{movingPick.player.name}</b> — tap a highlighted slot. Filled slots swap. Tap anywhere else to cancel.</>
              : filled.length > 0
                ? "Tap a drafted player to move them to another position they play."
                : "Players can only go where they have played in the games."}
          </p>
        </div>

        <div>
          {config.mode === "position" && state.targetSlotIndex === null && !state.currentClub ? (
            <div className="spin-stage">
              <div className="reel">Pick a position</div>
              <p className="field-note" style={{ marginBottom: 0 }}>
                Choose an empty slot on the pitch, then spin for a club to fill it.
              </p>
            </div>
          ) : !state.currentClub ? (
            <div className="spin-stage">
              <SpinWheel spinning={spinning} className="stage-wheel" />
              <div className={`reel${spinning ? " spinning" : ""}`}>
                {reelClub ?? (
                  state.targetSlotIndex !== null
                    ? `Spin for ${state.slots[state.targetSlotIndex]!.label}`
                    : "Spin the wheel"
                )}
              </div>
              <button
                className="btn btn-primary btn-lg"
                disabled={spinning || eligible.length === 0}
                onClick={() => doSpin(() => spin(state, pool))}
                data-testid="spin"
              >
                {spinning ? "Spinning…" : "Spin the wheel"}
              </button>
              <p className="field-note">
                {eligible.length.toLocaleString()} club-seasons can fill a remaining slot
              </p>
            </div>
          ) : (
            <>
              <div className="spin-stage">
                <SpinWheel spinning={spinning} className="stage-wheel" />
                <div className="reel" data-testid="current-club">
                  {state.currentClub.club}
                  <span className="reel-season">{state.currentClub.season}</span>
                </div>
                <button
                  className="btn"
                  disabled={state.rerollsLeft <= 0 || spinning}
                  onClick={() => doSpin(() => reroll(state, pool))}
                >
                  🔄 Re-roll ({state.rerollsLeft} left)
                </button>
              </div>

              <div className="picker">
                <div className="picker-head">
                  <div>
                    <h3>{state.currentClub.club}</h3>
                    <div className="sub">
                      {state.currentClub.season} · {sorted.length} eligible
                      {state.targetSlotIndex !== null && <> for {state.slots[state.targetSlotIndex]!.label}</>}
                    </div>
                  </div>
                  <div className="sort-row">
                    {(["rating", "position", "name"] as const).map((s) => (
                      <button key={s} aria-pressed={sort === s} onClick={() => setSort(s)}>
                        {s === "rating" ? "Rating ↓" : s === "position" ? "Position" : "A–Z"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="player-list" data-testid="player-list">
                  {sorted.map(({ player, slots, bestRating }) => (
                    <button
                      key={player.pid}
                      className="player-row"
                      onClick={() => take(player, slots)}
                      data-testid="player-choice"
                      data-pid={player.pid}
                      data-fits={slots.join(",")}
                      data-positions={playableSlots(player).join(",")}
                    >
                      <span className={ratingClass(bestRating, config.showRatings)}>
                        {config.showRatings ? bestRating : "?"}
                      </span>
                      <span className="player-main">
                        <strong>{player.name}</strong>
                        <small>{subline(player)}</small>
                      </span>
                      <PositionTags player={player} fits={slots} />
                    </button>
                  ))}

                  {blocked.length > 0 && (
                    <>
                      <div className="list-divider">
                        Position taken — move someone to make room
                      </div>
                      {blocked.map(({ player, slots }) => (
                        <div
                          key={player.pid}
                          className="player-row blocked"
                          data-testid="player-blocked"
                          data-pid={player.pid}
                          data-blocked-by={slots.join(",")}
                        >
                          <span className={ratingClass(0, false)}>–</span>
                          <span className="player-main">
                            <strong>{player.name}</strong>
                            <small>{slots.join(" / ")} already filled · {subline(player)}</small>
                          </span>
                          <PositionTags player={player} fits={[]} />
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          {error && <p className="field-note" style={{ color: "var(--bad)" }} data-testid="draft-error">{error}</p>}
        </div>
      </div>

      {pending && (
        <div className="modal-backdrop" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="slot-modal">
            <h3>{pending.player.name}</h3>
            <p>Where do they play? Each option shows exactly where on the pitch it sits.</p>
            <div className="slot-options">
              {state.slots
                .filter((s) => state.picks[s.index] === null && pending.slots.includes(s.slot))
                .map((s) => (
                  <button
                    key={s.index}
                    className="slot-option"
                    onClick={() => commit(pending.player, s.index)}
                    data-testid="slot-option"
                    data-slot-index={s.index}
                    data-side={s.side ?? ""}
                  >
                    <SlotMap slots={state.slots} picks={state.picks} highlight={s.index} />
                    <strong>{s.slot}</strong>
                    {s.side && <em className={`slot-side ${s.side}`}>{s.side}</em>}
                    {config.showRatings
                      ? <span>{ratingInSlot(pending.player, s.slot, config.lens)}</span>
                      : <small>rating hidden</small>}
                  </button>
                ))}
            </div>
            <button className="btn btn-block" style={{ marginTop: 14 }} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A thumbnail of the formation with one slot lit up.
 *
 * Two centre-backs used to appear in the chooser as two identical "CB"
 * buttons, so picking a side was a coin flip. This shows which one you are
 * actually choosing.
 */
function SlotMap({
  slots, picks, highlight,
}: { slots: SquadSlot[]; picks: (Pick | null)[]; highlight: number }) {
  return (
    <svg className="slot-map" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="1" y="1" width="98" height="98" rx="6" className="sm-pitch" />
      <line x1="1" y1="50" x2="99" y2="50" className="sm-line" />
      {slots.map((s) => {
        const [x, y] = s.coords;
        const state = s.index === highlight ? "on" : picks[s.index] ? "taken" : "open";
        return (
          <circle
            key={s.index}
            cx={x}
            // Coordinates run back-to-front; SVG y runs top-down.
            cy={100 - y}
            r={s.index === highlight ? 11 : 6}
            className={`sm-dot ${state}`}
          />
        );
      })}
    </svg>
  );
}

/** Nation and age, plus the full name when the display name is a nickname. */
function subline(p: PlayerSeason): string {
  const parts = [p.nation, String(p.age)];
  if (p.fullName && p.fullName !== p.name) parts.unshift(p.fullName);
  return parts.join(" · ");
}

/** Career positions, with the ones that fit an open slot lit up. */
function PositionTags({ player, fits }: { player: PlayerSeason; fits: Slot[] }) {
  return (
    <span className="pos-tags">
      {player.careerPositions.map((p, i) => (
        <span
          key={p}
          className={`pos-tag${slotNamesFor(p).some((s) => fits.includes(s)) ? " fit" : ""}${i === 0 ? " primary" : ""}`}
          title={i === 0 ? "Primary position" : "Secondary position"}
        >
          {p}
        </span>
      ))}
    </span>
  );
}

function ratingClass(rating: number, show: boolean): string {
  if (!show) return "ovr hidden-rating";
  if (rating >= 87) return "ovr elite";
  if (rating >= 80) return "ovr great";
  return "ovr";
}
