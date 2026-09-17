import { useEffect, useMemo, useState } from "react";
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
      <div className={heroClass}>
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
  return (
    <div className={`match-card ${cls}${highlight ? " latest" : ""}`} data-testid="match" data-round={m.round} data-gf={gf} data-ga={ga}>
      <div className="fixture">
        <span className="rd">MD {m.round}</span>
        <span className="home">{nameOf(m.homeId)}</span>
        <span className="score">{m.homeGoals}–{m.awayGoals}</span>
        <span className="away">{nameOf(m.awayId)}</span>
      </div>
      {scorers.length > 0 && (
        <div className={`match-scorers ${home ? "home" : "away"}`} data-testid="match-scorers">
          {scorers.map((s) => (
            <span key={s.pid} className="scorer" data-goals={s.minutes.length}>
              ⚽ {s.name}
              {s.minutes.length > 1 && <b> ×{s.minutes.length}</b>}{" "}
              <small>{s.minutes.map((min) => `${min}'`).join(", ")}</small>
            </span>
          ))}
        </div>
      )}
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
  return (
    <div className="window-panel" data-testid="january-prompt">
      <div className="eyebrow">Halfway · the January window is open</div>
      <h2 className="panel-title">Roll the window?</h2>
      <p>
        Roll for a transfer and real players can come in — or go out. A marquee signing, a
        like-for-like swap, your star sold, a season-ending injury. Roughly half the deck helps and
        half hurts. Or keep the XI you have.
      </p>
      <div className="actions" style={{ marginTop: 14 }}>
        <button className="btn btn-primary btn-lg" onClick={onRoll} data-testid="january-roll">🎲 Roll the window</button>
        <button className="btn btn-lg" onClick={onSkip} data-testid="january-skip">Keep this XI</button>
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
