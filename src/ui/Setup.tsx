import { useMemo, useState } from "react";
import { FORMATIONS } from "../engine/formations.ts";
import { LEAGUES, type LeagueId } from "../engine/leagues.ts";
import { makeRunCode, Rng } from "../engine/rng.ts";
import type { Difficulty, DraftConfig, DraftMode } from "../engine/draft.ts";
import type { RatingLens } from "../engine/ratings.ts";
import type { LeagueSummary } from "./useArchive.ts";

/** Games each club plays when a league runs this many teams. */
const gamesFor = (teams: number) => 2 * (teams - 1);

export interface SetupProps {
  leagues: LeagueSummary[];
  onStart: (config: DraftConfig) => void;
}

export function Setup({ leagues, onStart }: SetupProps) {
  const [picked, setPicked] = useState<LeagueId>("eng");
  const [playSeason, setPlaySeason] = useState<string | null>(null);
  const [formation, setFormation] = useState("4-3-3");
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [mode, setMode] = useState<DraftMode>("squad");
  const [lens, setLens] = useState<RatingLens>("season");
  const [showRatings, setShowRatings] = useState(true);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [teamName, setTeamName] = useState("");

  const cfg = LEAGUES[picked];
  const summary = useMemo(() => leagues.find((l) => l.id === picked), [leagues, picked]);
  const seasons = summary?.seasonList ?? [];

  // The competition defaults to the most recent season in the archive, and the
  // era range defaults to everything.
  const latest = seasons[seasons.length - 1] ?? null;
  const season = playSeason && seasons.includes(playSeason) ? playSeason : latest;
  const [from, to] = range ?? [0, Math.max(0, seasons.length - 1)];

  const teamsThatSeason = season ? summary?.shape?.[season] ?? cfg.teams : cfg.teams;
  const games = gamesFor(teamsThatSeason);
  const target = `${games}-0`;

  const start = () => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    onStart({
      league: picked,
      playSeason: season,
      formation,
      difficulty,
      mode,
      lens,
      showRatings: difficulty === "hard" ? false : showRatings,
      seasonRange: [seasons[lo] ?? "", seasons[hi] ?? ""],
      uniquePlayers: true,
      seed: makeRunCode(new Rng(`${Date.now()}:${Math.random()}`)),
      teamName: teamName.trim(),
    });
  };

  return (
    <div className="panel">
      <div className="field">
        <span className="field-label">Competition</span>
        <div className="league-grid">
          {leagues.map((l) => (
            <button
              key={l.id}
              className="league-card"
              aria-pressed={picked === l.id}
              style={{ "--pick": l.accent } as React.CSSProperties}
              onClick={() => setPicked(l.id)}
            >
              <span className="code">{l.code}</span>
              <strong>{l.country}</strong>
              <small>{l.clubSeasons} club-seasons</small>
              <small>{l.firstSeason}–{l.lastSeason}</small>
            </button>
          ))}
        </div>
        <p className="field-note">
          Draft from {(summary?.players ?? 0).toLocaleString()} {cfg.country} player-seasons across{" "}
          {summary?.seasons ?? 0} years, then take the weakest club's place in a real season.
        </p>
      </div>

      <div className="field">
        <span className="field-label">Season you play</span>
        <div className="chips">
          {[...seasons].reverse().map((s) => (
            <button key={s} className="chip" aria-pressed={season === s} onClick={() => setPlaySeason(s)}>
              {s}
            </button>
          ))}
        </div>
        <p className="field-note">
          The {teamsThatSeason - 1} clubs you face are the real {cfg.country} field from{" "}
          {season ?? "that season"}, at their real strength — you take the weakest one's place.
          That season ran {teamsThatSeason} clubs, so a perfect record is <b>{target}</b>. Your own
          players can still come from any season in the era range below.
        </p>
      </div>

      <div className="field">
        <span className="field-label">Formation</span>
        <div className="chips">
          {Object.keys(FORMATIONS).map((f) => (
            <button key={f} className="chip" aria-pressed={formation === f} onClick={() => setFormation(f)}>
              {f}
            </button>
          ))}
        </div>
        <p className="field-note">{FORMATIONS[formation]!.blurb}</p>
      </div>

      <div className="field">
        <span className="field-label">Difficulty</span>
        <div className="chip-grid">
          {([
            ["easy", "Easy", "3 re-rolls"],
            ["normal", "Normal", "1 re-roll"],
            ["hard", "Hard", "No re-rolls · ratings hidden"],
          ] as const).map(([id, label, note]) => (
            <button key={id} className="chip chip-tall" aria-pressed={difficulty === id} onClick={() => setDifficulty(id)}>
              <strong>{label}</strong>
              <small>{note}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Draft mode</span>
        <div className="chip-grid">
          <button className="chip chip-tall" aria-pressed={mode === "squad"} onClick={() => setMode("squad")}>
            <strong>Squad first</strong>
            <small>Spin a club, pick any player, choose their position</small>
          </button>
          <button className="chip chip-tall" aria-pressed={mode === "position"} onClick={() => setMode("position")}>
            <strong>Position first</strong>
            <small>Pick a slot, then spin for a club to fill it</small>
          </button>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Rating lens</span>
        <div className="chip-grid">
          <button className="chip chip-tall" aria-pressed={lens === "season"} onClick={() => setLens("season")}>
            <strong>Season</strong>
            <small>Rated as they were that exact year</small>
          </button>
          <button className="chip chip-tall" aria-pressed={lens === "prime"} onClick={() => setLens("prime")}>
            <strong>Prime</strong>
            <small>Every player at their career best</small>
          </button>
        </div>
      </div>

      {difficulty !== "hard" && (
        <div className="field">
          <span className="field-label">Show ratings</span>
          <div className="chips">
            <button className="chip" aria-pressed={showRatings} onClick={() => setShowRatings(true)}>On</button>
            <button className="chip" aria-pressed={!showRatings} onClick={() => setShowRatings(false)}>
              Off · blind mode
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <span className="field-label">Era</span>
        <div className="range-row">
          <span className="range-val">{seasons[Math.min(from, to)]}</span>
          <input type="range" min={0} max={Math.max(0, seasons.length - 1)} value={from}
                 onChange={(e) => setRange([Number(e.target.value), to])} aria-label="Earliest season" />
          <input type="range" min={0} max={Math.max(0, seasons.length - 1)} value={to}
                 onChange={(e) => setRange([from, Number(e.target.value)])} aria-label="Latest season" />
          <span className="range-val">{seasons[Math.max(from, to)]}</span>
        </div>
        <p className="field-note">
          Only club-seasons in this range can be spun. Narrow it to draft from an era you know.
        </p>
      </div>

      <div className="field">
        <span className="field-label">Team name</span>
        <input className="text-input" value={teamName} maxLength={28}
               placeholder="Your XI" onChange={(e) => setTeamName(e.target.value)} />
      </div>

      <button className="btn btn-primary btn-lg btn-block" onClick={start}>
        Start draft →
      </button>
    </div>
  );
}
