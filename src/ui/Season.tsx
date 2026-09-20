import { useEffect, useMemo, useRef, useState } from "react";
import type { DraftConfig } from "../engine/draft.ts";
import { januaryImpact, rollJanuary, type Gaffer, type JanuaryOutcome } from "../engine/extras.ts";
import { LEAGUES } from "../engine/leagues.ts";
import { ratingInSlot, type Pick } from "../engine/ratings.ts";
import {
  ordinal, simulateSeason, tableAfter, YOU,
  type GoalEvent, type Match, type SeasonResult,
} from "../engine/simulate.ts";
import type { ClubSeason } from "../engine/types.ts";
import { describeStyle } from "./App.tsx";
import { makePieces, trajectory } from "./confetti.ts";
import { Die } from "./icons.tsx";

export interface SeasonProps {
  picks: Pick[];
  pool: ClubSeason[];
  config: DraftConfig;
  seed: string;
  gaffer: Gaffer | null;
  useJanuary: boolean;
  onRestart: () => void;
  onReplay: () => void;
}

/** Milliseconds between matchdays while the season plays out. */
const TICK = 650;

type Window = { at: "closed" } | { at: "skipped" } | { at: "rolled"; outcome: JanuaryOutcome };

export function Season(props: SeasonProps) {
  const { picks, pool, config, seed, gaffer, useJanuary } = props;
  const [windowState, setWindowState] = useState<Window>({ at: "closed" });
  const [revealed, setRevealed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const common = {
    league: config.league, lens: config.lens, pool, seed,
    teamName: config.teamName, style: gaffer ?? undefined,
    opponentSeason: config.playSeason ?? undefined,
  };

  // The first half never depends on January: every match has its own seeded
  // stream, so re-simulating with a new second-half XI leaves it untouched.
  const firstPass = useMemo(() => simulateSeason({ ...common, picks }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [picks, pool, seed, gaffer, config]);

  const outcome = windowState.at === "rolled" ? windowState.outcome : null;
  const season: SeasonResult = useMemo(
    () => (outcome && outcome.moves.length
      ? simulateSeason({ ...common, picks, secondHalfPicks: outcome.picks })
      : firstPass),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [firstPass, outcome],
  );

  const windowPending = useJanuary && windowState.at === "closed";
  const cap = windowPending ? season.halfwayRound : season.rounds;
  const finished = revealed >= season.rounds;
  const atWindow = windowPending && revealed >= season.halfwayRound;

  useEffect(() => {
    if (!playing || revealed >= cap) return;
    const t = setTimeout(() => setRevealed((r) => Math.min(cap, r + 1)), TICK);
    return () => clearTimeout(t);
  }, [playing, revealed, cap]);

  const cfg = LEAGUES[config.league];
  const nameOf = (id: string) =>
    id === YOU ? season.you.name : season.table.find((r) => r.id === id)?.name ?? "—";

  const yourMatches = season.matches.filter((m) => m.homeId === YOU || m.awayId === YOU);
  const shown = yourMatches.filter((m) => m.round <= revealed);
  const latest = shown.at(-1) ?? null;
  const liveTable = useMemo(() => tableAfter(season, revealed), [season, revealed]);
  const liveYou = liveTable.find((r) => r.isYou)!;

  const rollWindow = () => {
    setWindowState({
      at: "rolled",
      outcome: rollJanuary({ picks, pool, lens: config.lens, seasonRange: config.seasonRange, seed }),
    });
    setPlaying(false);
  };

  if (!finished) {
    return (
      <div data-testid="season-live">
        <div className="live-head">
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              {cfg.country} · {season.seasonLabel}
              {season.replacedClub && <> · in place of {season.replacedClub}</>}
              {gaffer && <> · {gaffer.name}</>}
            </div>
            <div className="live-round" data-testid="live-round">
              Matchday {Math.min(revealed, season.rounds)} <span>of {season.rounds}</span>
            </div>
          </div>
          <div className="live-record" data-testid="live-record">
            <b>{liveYou.won}-{liveYou.drawn}-{liveYou.lost}</b>
            <span>{liveYou.points} pts · {ordinal(liveYou.position)}</span>
          </div>
        </div>

        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${(revealed / season.rounds) * 100}%` }} />
          {useJanuary && <i style={{ left: `${(season.halfwayRound / season.rounds) * 100}%` }} title="January window" />}
        </div>

        {atWindow ? (
          <JanuaryPrompt onRoll={rollWindow} onSkip={() => { setWindowState({ at: "skipped" }); setPlaying(true); }} />
        ) : outcome && revealed === season.halfwayRound && !playing ? (
          <JanuaryResult
            outcome={outcome}
            lens={config.lens}
            before={picks}
            showRatings={config.showRatings}
            onContinue={() => setPlaying(true)}
          />
        ) : (
          <div className="live-controls">
            <button className="btn" onClick={() => setPlaying(!playing)} data-testid="play-pause">
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <button className="btn" disabled={revealed >= cap} onClick={() => { setPlaying(false); setRevealed((r) => Math.min(cap, r + 1)); }} data-testid="next-matchday">
              Next matchday
            </button>
            <button className="btn btn-primary" disabled={revealed >= cap} onClick={() => setRevealed(cap)} data-testid="skip-ahead">
              {windowPending ? "Skip to January" : "Skip to full time"}
            </button>
          </div>
        )}

        <div className="result-grid">
          <div className="card">
            <h3>Your matchdays</h3>
            {latest ? (
              <MatchCard match={latest} nameOf={nameOf} highlight />
            ) : (
              <div className="event-note">The fixtures are out. First whistle coming up…</div>
            )}
            <div className="results-scroll" data-testid="live-results">
              {[...shown].reverse().slice(1).map((m) => (
                <MatchCard key={`${m.round}:${m.homeId}`} match={m} nameOf={nameOf} />
              ))}
            </div>
          </div>
          <div className="card">
            <h3>Table</h3>
            <LeagueTable rows={liveTable} teams={season.teams} compact />
          </div>
        </div>
      </div>
    );
  }

  const share = async () => {
    const lines = [
      `${season.you.name} — ${cfg.country} ${season.seasonLabel}`,
      `${season.you.won}W ${season.you.drawn}D ${season.you.lost}L · ${season.you.points} pts · ${ordinal(season.you.position)}`,
      season.perfect ? `⭐ PERFECT SEASON ${season.perfectTarget} ⭐` : season.invincible ? "🛡 Unbeaten" : "",
      `Seed ${seed}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setToast("Result copied to clipboard");
    } catch {
      setToast("Could not copy");
    }
    setTimeout(() => setToast(null), 2200);
  };

  const heroClass = season.perfect ? "result-hero perfect" : season.champion ? "result-hero champion" : "result-hero";
  const finalXi = outcome?.picks ?? picks;
  const leftInJanuary = new Set(outcome?.moves.map((m) => m.out.player.pid));

  return (
    <div data-testid="season-result">
      {season.champion && <Confetti intense={season.perfect} />}
      <div className={heroClass}>
        {season.champion && <Trophy perfect={season.perfect} />}
        <div className="eyebrow">
          {cfg.country} · {season.seasonLabel} · {season.gamesPlayed} games
          {season.replacedClub && <> · in place of {season.replacedClub}</>}
        </div>
        <div className="scoreline" data-testid="final-record">
          {season.you.won}<span style={{ opacity: 0.35 }}>-</span>{season.you.drawn}
          <span style={{ opacity: 0.35 }}>-</span>{season.you.lost}
        </div>
        <h2>{season.headline}</h2>
        <div className="sub">
          {season.you.points} points · {season.you.goalsFor} scored · {season.you.goalsAgainst} conceded ·{" "}
          <span data-testid="final-position">{ordinal(season.you.position)}</span> of {season.teams}
        </div>
        <div className="badges">
          {season.perfect && <span className="badge gold">Perfect {season.perfectTarget}</span>}
          {season.invincible && !season.perfect && <span className="badge gold">Invincible</span>}
          {season.champion && <span className="badge green">Champions</span>}
          <span className="badge">Seed {seed}</span>
        </div>
      </div>

      {outcome && (
        <div className="card" data-testid="january-summary">
          <h3>January window</h3>
          <JanuaryMoves outcome={outcome} lens={config.lens} before={picks} showRatings={config.showRatings} />
        </div>
      )}

      <div className="result-grid">
        <div>
          <div className="card">
            <h3>Final table</h3>
            <LeagueTable rows={season.table} teams={season.teams} />
          </div>

          <div className="card">
            <h3>Every result</h3>
            <div className="results-scroll tall" data-testid="all-results">
              {yourMatches.map((m) => (
                <MatchCard key={`${m.round}:${m.homeId}`} match={m} nameOf={nameOf} />
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h3>Your XI</h3>
            <div className="rating-bars">
              {([
                ["Attack", (season.secondHalfRating ?? season.rating).lines.ATT],
                ["Midfield", (season.secondHalfRating ?? season.rating).lines.MID],
                ["Defence", (season.secondHalfRating ?? season.rating).lines.DEF],
                ["Keeper", (season.secondHalfRating ?? season.rating).lines.GK],
              ] as const).map(([label, value]) => (
                <div className="rating-bar" key={label}>
                  <span>{label}</span>
                  <span className="track">
                    <span className="fill" style={{ width: `${Math.max(0, Math.min(100, (value - 50) * 2))}%` }} />
                  </span>
                  <b>{value.toFixed(0)}</b>
                </div>
              ))}
            </div>
            <div className="xi-list">
              {[...finalXi].sort((a, b) => a.slotIndex - b.slotIndex).map((p) => (
                <div className="xi-row" key={p.slotIndex}>
                  <span className="slot-tag">{p.slot}</span>
                  <span>
                    {p.player.name}
                    <small>
                      {p.club} · {p.season}
                      {outcome?.moves.some((m) => m.in.player.pid === p.player.pid) && " · signed in January"}
                    </small>
                  </span>
                  <span className="r">{config.showRatings ? ratingInSlot(p.player, p.slot, config.lens) : "?"}</span>
                </div>
              ))}
            </div>
            {gaffer && (
              <div className="event-note" style={{ borderTop: "1px solid var(--line)" }}>
                <strong>{gaffer.name} · {gaffer.style}</strong>
                {gaffer.blurb} <span className="gaffer-effect">{describeStyle(gaffer)}</span>
              </div>
            )}
          </div>

          <div className="card">
            <h3>Goals & assists</h3>
            <table data-testid="scorers">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">G</th>
                  <th className="num">A</th>
                </tr>
              </thead>
              <tbody>
                {season.scorers.filter((s) => s.goals || s.assists).map((s) => (
                  <tr key={s.pid}>
                    <td>
                      {s.name} <span style={{ color: "var(--text-faint)" }}>{s.slot}</span>
                      {leftInJanuary.has(s.pid) && <span style={{ color: "var(--text-faint)" }}> · left in Jan</span>}
                    </td>
                    <td className="num"><b>{s.goals}</b></td>
                    <td className="num">{s.assists}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Season notes</h3>
            <div className="event-note">
              Longest winning run <strong style={{ display: "inline" }}>{season.longestWinStreak}</strong> games.
              {season.biggestWin && (
                <> Biggest win {season.biggestWin.match.homeGoals}–{season.biggestWin.match.awayGoals} against{" "}
                  {nameOf(season.biggestWin.match.homeId === YOU ? season.biggestWin.match.awayId : season.biggestWin.match.homeId)}.</>
              )}
              {season.worstDefeat
                ? <> Worst day: {season.worstDefeat.match.homeGoals}–{season.worstDefeat.match.awayGoals} to{" "}
                    {nameOf(season.worstDefeat.match.homeId === YOU ? season.worstDefeat.match.awayId : season.worstDefeat.match.homeId)}.</>
                : <> Never beaten.</>}
            </div>
          </div>
        </div>
      </div>

      <div className="actions">
        <button className="btn btn-primary btn-lg" onClick={props.onReplay} data-testid="replay">Re-simulate this XI</button>
        <button className="btn btn-lg" onClick={share}>Copy result</button>
        <button className="btn btn-lg" onClick={props.onRestart}>New draft</button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** "Haaland 2 (23', 67'), Salah (81')" — your scorers, grouped per player. */
export function groupScorers(goals: GoalEvent[]): { pid: number; name: string; minutes: number[] }[] {
  const byPid = new Map<number, { pid: number; name: string; minutes: number[] }>();
  for (const g of goals) {
    const row = byPid.get(g.pid) ?? byPid.set(g.pid, { pid: g.pid, name: g.name, minutes: [] }).get(g.pid)!;
    row.minutes.push(g.minute);
  }
  return [...byPid.values()].sort((a, b) => b.minutes.length - a.minutes.length || a.minutes[0]! - b.minutes[0]!);
}

function MatchCard({ match: m, nameOf, highlight }: { match: Match; nameOf: (id: string) => string; highlight?: boolean }) {
  const home = m.homeId === YOU;
  const gf = home ? m.homeGoals : m.awayGoals;
  const ga = home ? m.awayGoals : m.homeGoals;
  const cls = gf > ga ? "win" : gf < ga ? "loss" : "draw";
  const scorers = groupScorers(m.yourGoals);
  const outcome = gf > ga ? "Won" : gf < ga ? "Lost" : "Drawn";
  return (
    <div
      className={`match-card ${cls}${highlight ? " latest" : ""}`}
      data-testid="match"
      data-round={m.round}
      data-gf={gf}
      data-ga={ga}
      data-outcome={cls}
    >
      <div className={`fixture ${cls}`}>
        <span className="rd">MD {m.round}</span>
        <span className="home">{nameOf(m.homeId)}</span>
        <span className="score" title={`${outcome} ${gf}–${ga}`}>{m.homeGoals}–{m.awayGoals}</span>
        <span className="away">{nameOf(m.awayId)}</span>
      </div>
      <GoalTimeline match={m} />
      {scorers.length > 0 && (
        <div className={`match-scorers ${home ? "home" : "away"}`} data-testid="match-scorers">
          {scorers.map((s) => (
            <span key={s.pid} className="scorer" data-goals={s.minutes.length}>
              <BallIcon /> {s.name}
              {s.minutes.length > 1 && <b> ×{s.minutes.length}</b>}{" "}
              <small>{s.minutes.map((min) => `${min}'`).join(", ")}</small>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Full-screen confetti for winning the league.
 *
 * It fires up from the bottom like a row of cannons, fans outward, then
 * falls back gently — rather than drifting down from the top, which reads as
 * weather instead of celebration. The two-phase arc is done with per-keyframe
 * easing in CSS; the values below only set where each piece goes.
 *
 * Pieces are laid out once from a fixed pattern rather than re-randomised on
 * every render, the whole layer is inert to pointers, and it is switched off
 * entirely for anyone who asks for reduced motion.
 */
function Confetti({ intense = false }: { intense?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const pieces = useMemo(
    () => makePieces(
      intense ? 320 : 240,
      typeof window === "undefined" ? 1280 : window.innerWidth,
      typeof window === "undefined" ? 800 : window.innerHeight,
    ),
    [intense],
  );

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    // Anyone who has asked for less motion gets the result without the show.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof el.animate !== "function") return;

    const running = [...el.children].map((child, i) =>
      (child as HTMLElement).animate(trajectory(pieces[i]!), {
        duration: pieces[i]!.duration * 1000,
        delay: pieces[i]!.delay * 1000,
        easing: "linear", // the physics is in the samples, not the curve
        fill: "forwards",
      }),
    );
    return () => running.forEach((a) => a.cancel());
  }, [pieces]);

  return (
    <div className="confetti" data-testid="confetti" aria-hidden="true" ref={host}>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={`confetto c${p.hue}${p.ball ? " is-ball" : ""} ${p.fromLeft ? "from-left" : "from-right"}`}
        >
          {p.ball && <BallIcon />}
        </span>
      ))}
    </div>
  );
}

/** The trophy lift above the final record. */
function Trophy({ perfect }: { perfect: boolean }) {
  return (
    <div className={`trophy${perfect ? " perfect" : ""}`} data-testid="trophy" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <path className="t-cup" d="M20 10h24v14a12 12 0 0 1-24 0Z" />
        <path className="t-handle" d="M20 13h-6a6 6 0 0 0 6 10M44 13h6a6 6 0 0 1-6 10" />
        <path className="t-stem" d="M30 36h4v9h-4z" />
        <path className="t-base" d="M22 45h20v5H22z" />
        <path className="t-plinth" d="M18 50h28v5H18z" />
        <g className="t-sparks">
          <path d="M12 8l1.6 3.4L17 13l-3.4 1.6L12 18l-1.6-3.4L7 13l3.4-1.6Z" />
          <path d="M52 6l1.2 2.6L56 10l-2.8 1.2L52 14l-1.2-2.8L48 10l2.8-1.4Z" />
          <path d="M55 26l1 2.2 2.2 1-2.2 1L55 32l-1-1.8-2.2-1 2.2-1Z" />
        </g>
      </svg>
    </div>
  );
}

/** A small inline football, so goals read at a glance without an emoji font. */
function BallIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={`ball ${className}`} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" className="ball-body" />
      <path className="ball-panel" d="M8 3.6 10.6 5.5 9.6 8.6H6.4L5.4 5.5Z" />
      <path className="ball-seam" d="M8 1v2.6M2.1 6.4l3.3-.9M13.9 6.4l-3.3-.9M4.4 13.3l2-4.7M11.6 13.3l-2-4.7" />
    </svg>
  );
}

/**
 * Both sides' goals on one 90-minute strip: yours above the line in green,
 * theirs below in red. Opposition scorers are not named because the archive
 * holds no opposition line-ups.
 */
function GoalTimeline({ match: m }: { match: Match }) {
  const mine = m.yourGoals.map((g) => g.minute);
  const theirs = m.oppGoals ?? [];
  if (mine.length === 0 && theirs.length === 0) return null;

  const at = (minute: number) => `${Math.min(98, Math.max(2, (minute / 92) * 100))}%`;

  return (
    <div className="goal-timeline" data-testid="goal-timeline" aria-hidden="true">
      <span className="gt-line" />
      {mine.map((minute, i) => (
        <span key={`m${i}`} className="gt-goal mine" style={{ left: at(minute) }} title={`You scored ${minute}'`}>
          <BallIcon />
          <em>{minute}'</em>
        </span>
      ))}
      {theirs.map((minute, i) => (
        <span key={`t${i}`} className="gt-goal theirs" style={{ left: at(minute) }} title={`Conceded ${minute}'`}>
          <BallIcon />
          <em>{minute}'</em>
        </span>
      ))}
      <span className="gt-end">90'</span>
    </div>
  );
}

function LeagueTable({ rows, teams, compact }: { rows: SeasonResult["table"]; teams: number; compact?: boolean }) {
  return (
    <table data-testid={compact ? "live-table" : "final-table"}>
      <thead>
        <tr>
          <th style={{ width: 28 }}>#</th>
          <th>Club</th>
          <th className="num">P</th>
          {!compact && <><th className="num">W</th><th className="num">D</th><th className="num">L</th></>}
          <th className="num">GD</th>
          <th className="num">Pts</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={[
            r.isYou ? "you" : "",
            r.position <= 4 ? "ucl" : "",
            r.position > teams - 3 ? "rel" : "",
          ].filter(Boolean).join(" ")}>
            <td>{r.position}</td>
            <td>{r.name}</td>
            <td className="num">{r.played}</td>
            {!compact && <><td className="num">{r.won}</td><td className="num">{r.drawn}</td><td className="num">{r.lost}</td></>}
            <td className="num">{r.goalDifference > 0 ? "+" : ""}{r.goalDifference}</td>
            <td className="num"><b>{r.points}</b></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function JanuaryPrompt({ onRoll, onSkip }: { onRoll: () => void; onSkip: () => void }) {
  const [rolling, setRolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Let the die tumble for a beat before the card lands, so the roll reads as
  // a roll rather than the outcome appearing the instant you commit to it.
  const roll = () => {
    if (rolling) return;
    setRolling(true);
    timer.current = setTimeout(onRoll, 900);
  };

  return (
    <div className="window-panel" data-testid="january-prompt">
      <div className="eyebrow">Halfway · the January window is open</div>
      <h2 className="panel-title">Roll the window?</h2>
      <p>
        Roll for a transfer and real players can come in — or go out. A marquee signing, a
        like-for-like swap, your star sold, a season-ending injury. Roughly half the deck helps and
        half hurts. Or keep the XI you have.
      </p>
      {rolling && <Die rolling className="stage-die" />}
      <div className="actions" style={{ marginTop: 14 }}>
        <button className="btn btn-primary btn-lg" onClick={roll} disabled={rolling} data-testid="january-roll">
          <Die rolling={rolling} className="btn-die" />
          {rolling ? "Rolling…" : "Roll the window"}
        </button>
        <button className="btn btn-lg" onClick={onSkip} disabled={rolling} data-testid="january-skip">
          Keep this XI
        </button>
      </div>
    </div>
  );
}

function JanuaryResult(props: {
  outcome: JanuaryOutcome; lens: DraftConfig["lens"]; before: Pick[]; showRatings: boolean; onContinue: () => void;
}) {
  return (
    <div className={`window-panel tone-${props.outcome.tone}`} data-testid="january-result">
      <div className="eyebrow">January window</div>
      <JanuaryMoves {...props} />
      <div className="actions" style={{ marginTop: 6 }}>
        <button className="btn btn-primary btn-lg" onClick={props.onContinue} data-testid="second-half">
          Play the second half →
        </button>
      </div>
    </div>
  );
}

function JanuaryMoves({ outcome, lens, before, showRatings }: {
  outcome: JanuaryOutcome; lens: DraftConfig["lens"]; before: Pick[]; showRatings: boolean;
}) {
  const impact = januaryImpact(before, outcome.picks, lens);
  return (
    <div className="event-note" data-testid="january-outcome" data-card={outcome.id}>
      <strong className={`tone-${outcome.tone}`}>{outcome.title}</strong>
      {outcome.text}
      {outcome.moves.length === 0 ? (
        <p className="window-none">No change to the XI.</p>
      ) : (
        <>
          <div className="moves">
            {outcome.moves.map((m) => (
              <div className="move" key={m.slotIndex} data-testid="january-move">
                <span className="slot-tag">{m.out.slot}</span>
                <span className="move-out">
                  <small>Out · {m.reason}</small>
                  {m.out.player.name}
                  {showRatings && <b> {ratingInSlot(m.out.player, m.out.slot, lens)}</b>}
                </span>
                <span className="move-arrow">→</span>
                <span className="move-in">
                  <small>In · {m.in.club} {m.in.season}</small>
                  {m.in.player.name}
                  {showRatings && <b> {ratingInSlot(m.in.player, m.in.slot, lens)}</b>}
                </span>
              </div>
            ))}
          </div>
          {showRatings && (
            <p className="window-none">
              {impact === 0
                ? "Team rating unchanged for the second half."
                : `Team rating ${impact > 0 ? "+" : "−"}${Math.abs(impact).toFixed(1)} for the second half.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
