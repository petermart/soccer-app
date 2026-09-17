import { useMemo, useState } from "react";
import { LEAGUES, type LeagueId } from "../engine/leagues.ts";
import { ordinal, simulateSeason, YOU, type SeasonResult } from "../engine/simulate.ts";
import { drawJanuaryEvent, simulateCup, GAFFERS, type Gaffer } from "../engine/extras.ts";
import { ratingInSlot, type Pick, type RatingLens } from "../engine/ratings.ts";
import type { ClubSeason } from "../engine/types.ts";

export interface ResultProps {
  picks: Pick[];
  pool: ClubSeason[];
  league: LeagueId;
  /** The real season you drop into; null picks one at random from the seed. */
  playSeason: string | null;
  lens: RatingLens;
  seed: string;
  teamName: string;
  gaffer: Gaffer | null;
  useJanuary: boolean;
  useEurope: boolean;
  onRestart: () => void;
  onReplay: () => void;
}

export function Result(props: ResultProps) {
  const { picks, pool, league, playSeason, lens, seed, teamName, gaffer, useJanuary, useEurope } = props;
  const [toast, setToast] = useState<string | null>(null);

  const january = useMemo(
    () => (useJanuary ? drawJanuaryEvent(seed) : null),
    [useJanuary, seed],
  );

  const attackModifier = (gaffer?.attack ?? 1) * (january?.attack ?? 1);
  const defenceModifier = (gaffer?.defence ?? 1) * (january?.defence ?? 1);

  const season: SeasonResult = useMemo(
    () => simulateSeason({
      league, picks, lens, pool, seed, teamName, attackModifier, defenceModifier,
      opponentSeason: playSeason ?? undefined,
    }),
    [league, picks, lens, pool, seed, teamName, attackModifier, defenceModifier, playSeason],
  );

  const cup = useMemo(
    () => (useEurope
      ? simulateCup({
          rating: season.rating, league, leaguePosition: season.you.position,
          continental: pool, seed, attackModifier, defenceModifier,
        })
      : null),
    [useEurope, season, league, pool, seed, attackModifier, defenceModifier],
  );

  const cfg = LEAGUES[league];
  const yourMatches = season.matches.filter((m) => m.homeId === YOU || m.awayId === YOU);
  const nameOf = (id: string) =>
    id === YOU ? season.you.name : season.table.find((r) => r.id === id)?.name ?? "—";

  const share = async () => {
    const lines = [
      `${season.you.name} — ${cfg.country} ${season.seasonLabel}`,
      `${season.you.won}W ${season.you.drawn}D ${season.you.lost}L · ${season.you.points} pts · ${ordinal(season.you.position)}`,
      season.perfect ? `⭐ PERFECT SEASON ${season.perfectTarget} ⭐` : season.invincible ? "🛡 Unbeaten" : "",
      cup?.qualified ? `Europe: ${cup.finish}` : "",
      `Seed ${seed}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setToast("Result copied to clipboard");
      setTimeout(() => setToast(null), 2200);
    } catch {
      setToast("Could not copy");
      setTimeout(() => setToast(null), 2200);
    }
  };

  const heroClass = season.perfect ? "result-hero perfect" : season.champion ? "result-hero champion" : "result-hero";

  return (
    <div>
      <div className={heroClass}>
        <div className="eyebrow">
          {cfg.country} · {season.seasonLabel} · {season.gamesPlayed} games
          {season.replacedClub && <> · in place of {season.replacedClub}</>}
        </div>
        <div className="scoreline">
          {season.you.won}<span style={{ opacity: 0.35 }}>-</span>{season.you.drawn}
          <span style={{ opacity: 0.35 }}>-</span>{season.you.lost}
        </div>
        <h2>{season.headline}</h2>
        <div className="sub">
          {season.you.points} points · {season.you.goalsFor} scored · {season.you.goalsAgainst} conceded ·{" "}
          {ordinal(season.you.position)} of {season.teams}
        </div>
        <div className="badges">
          {season.perfect && <span className="badge gold">Perfect {season.perfectTarget}</span>}
          {season.invincible && !season.perfect && <span className="badge gold">Invincible</span>}
          {season.champion && <span className="badge green">Champions</span>}
          {cup?.won && <span className="badge gold">European Champions</span>}
          {cup?.qualified && !cup.won && <span className="badge">Europe: {cup.finish}</span>}
          <span className="badge">Seed {seed}</span>
        </div>
      </div>

      {january && (
        <div className="card">
          <h3>January window</h3>
          <div className="event-note">
            <strong>{january.title}</strong>
            {january.text}{" "}
            {january.attack === 1 && january.defence === 1
              ? "No change to the side."
              : `Attack ${pct(january.attack)}, defence ${pct(january.defence)}.`}
          </div>
        </div>
      )}

      <div className="result-grid">
        <div>
          <div className="card">
            <h3>Final table</h3>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th>Club</th>
                  <th className="num">P</th>
                  <th className="num">W</th>
                  <th className="num">D</th>
                  <th className="num">L</th>
                  <th className="num">GD</th>
                  <th className="num">Pts</th>
                </tr>
              </thead>
              <tbody>
                {season.table.map((r) => (
                  <tr key={r.id} className={[
                    r.isYou ? "you" : "",
                    r.position <= 4 ? "ucl" : "",
                    r.position > season.teams - 3 ? "rel" : "",
                  ].filter(Boolean).join(" ")}>
                    <td>{r.position}</td>
                    <td>{r.name}</td>
                    <td className="num">{r.played}</td>
                    <td className="num">{r.won}</td>
                    <td className="num">{r.drawn}</td>
                    <td className="num">{r.lost}</td>
                    <td className="num">{r.goalDifference > 0 ? "+" : ""}{r.goalDifference}</td>
                    <td className="num"><b>{r.points}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Every result</h3>
            <div className="results-scroll">
              {yourMatches.map((m, i) => {
                const home = m.homeId === YOU;
                const gf = home ? m.homeGoals : m.awayGoals;
                const ga = home ? m.awayGoals : m.homeGoals;
                const cls = gf > ga ? "win" : gf < ga ? "loss" : "draw";
                return (
                  <div key={i} className={`fixture ${cls}`}>
                    <span className="rd">{i + 1}</span>
                    <span className="home">{nameOf(m.homeId)}</span>
                    <span className="score">{m.homeGoals}–{m.awayGoals}</span>
                    <span className="away">{nameOf(m.awayId)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <h3>Your XI</h3>
            <div className="rating-bars">
              {([
                ["Attack", season.rating.lines.ATT],
                ["Midfield", season.rating.lines.MID],
                ["Defence", season.rating.lines.DEF],
                ["Keeper", season.rating.lines.GK],
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
              {[...picks].sort((a, b) => a.slotIndex - b.slotIndex).map((p) => (
                <div className="xi-row" key={p.slotIndex}>
                  <span className="slot-tag">{p.slot}</span>
                  <span>
                    {p.player.name}
                    <small>{p.club} · {p.season}</small>
                  </span>
                  <span className="r">{ratingInSlot(p.player, p.slot, lens)}</span>
                </div>
              ))}
            </div>
            {gaffer && (
              <div className="event-note" style={{ borderTop: "1px solid var(--line)" }}>
                <strong>{gaffer.name} · {gaffer.style}</strong>
                {gaffer.blurb}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Goals & assists</h3>
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">G</th>
                  <th className="num">A</th>
                </tr>
              </thead>
              <tbody>
                {season.scorers.filter((s) => s.goals || s.assists).map((s) => (
                  <tr key={s.name + s.slot}>
                    <td>{s.name} <span style={{ color: "var(--text-faint)" }}>{s.slot}</span></td>
                    <td className="num"><b>{s.goals}</b></td>
                    <td className="num">{s.assists}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cup && cup.qualified && (
            <div className="card">
              <h3>European nights — {cup.finish}</h3>
              {cup.ties.map((tie, i) => (
                <div key={i} className={`cup-tie ${tie.won ? "won" : "lost"}`}>
                  <span>
                    <span className="rd">{tie.round}</span>
                    <br />
                    {tie.opponent} <span style={{ color: "var(--text-faint)" }}>{tie.opponentSeason}</span>
                  </span>
                  <span className="agg">
                    {tie.yourAggregate}–{tie.theirAggregate}
                    {tie.penalties && (
                      <small style={{ display: "block", fontSize: 10, color: "var(--text-faint)" }}>
                        pens {tie.penalties.you}–{tie.penalties.them}
                      </small>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

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
        <button className="btn btn-primary btn-lg" onClick={props.onReplay}>Re-simulate this XI</button>
        <button className="btn btn-lg" onClick={share}>Copy result</button>
        <button className="btn btn-lg" onClick={props.onRestart}>New draft</button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

const pct = (v: number) => `${v >= 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`;

export { GAFFERS };
