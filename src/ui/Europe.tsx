import { useMemo, useState } from "react";
import {
  COMPETITIONS, competitionFor, simulateEurope,
  type Competition, type EuroRun, type EuropeData,
} from "../engine/europe.ts";
import { LEAGUES, type LeagueId } from "../engine/leagues.ts";
import type { Pick, RatingLens, TeamRating } from "../engine/ratings.ts";
import type { MatchStyle } from "../engine/simulate.ts";
import { YOU } from "../engine/simulate.ts";
import { Confetti, MatchCard } from "./Season.tsx";
import { Flag } from "./icons.tsx";
import europeData from "../data/europe.json" with { type: "json" };

export interface EuropeProps {
  season: string;
  league: LeagueId;
  /** Where you finished the league, which is what earns the place. */
  position: number;
  teamName: string;
  picks: Pick[];
  lens: RatingLens;
  rating: TeamRating;
  style?: MatchStyle;
  seed: string;
}

/**
 * European nights, played after the domestic season.
 *
 * The fields are the clubs that really qualified that season, so the clubs
 * are named rather than invented — with the caveats the engine's header sets
 * out, and a short version of them shown to the player here.
 */
export function Europe(props: EuropeProps) {
  const { season, league, position, teamName, picks, lens, rating, style, seed } = props;
  const [run, setRun] = useState<EuroRun | null>(null);

  const competition = competitionFor(league, position);
  const data = europeData as EuropeData;
  const hasField = Boolean(data[season]);

  const play = () => {
    if (!competition) return;
    setRun(simulateEurope({
      data, season, competition, yourLeague: league,
      yourName: teamName.trim() || "Your XI",
      picks, lens, yourAttack: rating.attack, yourDefence: rating.defence, style, seed,
    }));
  };

  if (!competition || !hasField) {
    return (
      <div className="card europe-card" data-testid="europe-none">
        <h3>European nights</h3>
        <div className="event-note">
          {ordinalPlace(position)} is not enough. No European football this time — the top six
          go through: four to the Champions League, fifth to the Europa League, sixth to the
          Conference League.
        </div>
      </div>
    );
  }

  const meta = COMPETITIONS[competition];

  return (
    <div
      className="card europe-card"
      style={{ "--comp": meta.accent } as React.CSSProperties}
      data-testid="europe"
      data-competition={competition}
    >
      <h3>European nights</h3>

      {!run ? (
        <div className="europe-intro">
          <div className="europe-badge">{meta.short}</div>
          <strong>{ordinalPlace(position)} in {LEAGUES[league].country} — you are in the {meta.name}.</strong>
          <p className="field-note">
            You take the place of the club from {LEAGUES[league].country} that qualified most
            narrowly. Everyone else is a real entrant for {season}, drawn from where they
            finished the season before.
          </p>
          <button className="btn btn-primary btn-lg" onClick={play} data-testid="play-europe">
            Play the {meta.name} →
          </button>
          <RulesNote />
        </div>
      ) : (
        <EuropeRun run={run} teamName={teamName.trim() || "Your XI"} />
      )}
    </div>
  );
}

function EuropeRun({ run, teamName }: { run: EuroRun; teamName: string }) {
  const meta = COMPETITIONS[run.competition];
  const nameOf = useMemo(() => {
    const names = new Map(run.clubs.map((c) => [c.id, c.name]));
    names.set(YOU, teamName);
    return (id: string) => names.get(id) ?? "—";
  }, [run, teamName]);
  const leagueOf = useMemo(
    () => new Map(run.clubs.map((c) => [c.id, c.league])),
    [run],
  );

  return (
    <>
      {run.won && <Confetti />}
      <div className={`europe-result${run.won ? " won" : ""}`} data-testid="europe-finish">
        <div className="europe-badge">{meta.short}</div>
        <strong>{run.finish}</strong>
        <span>
          {meta.name} {run.season}
          {run.displaced && <> · in place of {run.displaced}</>}
        </span>
      </div>

      {run.ties.length > 0 && (
        <div className="euro-ties" data-testid="europe-ties">
          {run.ties.map((tie, i) => (
            <div key={i} className={`cup-tie ${tie.won ? "won" : "lost"}`}>
              <span>
                <span className="rd">{tie.round}{tie.neutral && " · neutral ground"}</span>
                <br />
                <Flag league={tie.opponentLeague} className="inline-flag" /> {tie.opponent}
              </span>
              <span className="agg">
                {tie.yourAggregate}–{tie.theirAggregate}
                {tie.penalties && (
                  <small>pens {tie.penalties.you}–{tie.penalties.them}</small>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="europe-grid">
        <div>
          <h4 className="europe-sub">
            League phase · finished {ordinalPlace(run.leaguePosition)} of {run.table.length}
          </h4>
          <table data-testid="europe-table">
            <thead>
              <tr>
                <th style={{ width: 26 }}>#</th>
                <th>Club</th>
                <th className="num">P</th>
                <th className="num">GD</th>
                <th className="num">Pts</th>
              </tr>
            </thead>
            <tbody>
              {run.table.map((r) => (
                <tr key={r.id} className={r.isYou ? "you" : ""}>
                  <td>{r.position}</td>
                  <td className="euro-club">
                    <Flag league={leagueOf.get(r.id) ?? "eng"} className="inline-flag" />
                    {r.name}
                  </td>
                  <td className="num">{r.played}</td>
                  <td className="num">{r.goalDifference > 0 ? "+" : ""}{r.goalDifference}</td>
                  <td className="num"><b>{r.points}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="europe-sub">Your nights</h4>
          <div className="results-scroll tall" data-testid="europe-matches">
            {run.yourMatches.map((m, i) => (
              <MatchCard key={i} match={m} nameOf={nameOf} />
            ))}
          </div>
        </div>
      </div>

      <RulesNote />
    </>
  );
}

/** The honest small print, in the place someone would want it. */
function RulesNote() {
  const [open, setOpen] = useState(false);
  return (
    <p className="field-note europe-note">
      <button className="link-btn" onClick={() => setOpen(!open)} data-testid="europe-note-toggle">
        {open ? "Hide" : "How qualification works here"}
      </button>
      {open && (
        <span className="europe-note-body">
          Top four enter the Champions League, fifth the Europa League, sixth the Conference
          League, for every league in every season. The real rulebook varies: cup winners take a
          Europa League place regardless of where they finish, the best-performing countries have
          had a fifth Champions League place since 2024/25, France and Italy often had three
          rather than four, and the Conference League only exists from 2021/22. The fields are
          also built from the big five leagues alone, because those are the leagues this archive
          has ratings for — a real Champions League also has Portuguese, Dutch and Scottish clubs.
          The rule lives in one place in <code>src/engine/europe.ts</code> and can be corrected
          per league or per season.
        </span>
      )}
    </p>
  );
}

function ordinalPlace(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
