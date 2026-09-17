import { useState } from "react";
import type { DraftConfig } from "../engine/draft.ts";
import { GAFFERS, type Gaffer } from "../engine/extras.ts";
import { LEAGUES } from "../engine/leagues.ts";
import type { Pick } from "../engine/ratings.ts";
import { Draft } from "./Draft.tsx";
import { Result } from "./Result.tsx";
import { Setup } from "./Setup.tsx";
import { useLeagueSummaries, usePool } from "./useArchive.ts";

type Screen =
  | { at: "home" }
  | { at: "draft"; config: DraftConfig }
  | { at: "gaffer"; config: DraftConfig; picks: Pick[] }
  | { at: "result"; config: DraftConfig; picks: Pick[]; gaffer: Gaffer | null; runSeed: string };

export function App() {
  const { leagues, error } = useLeagueSummaries();
  const [screen, setScreen] = useState<Screen>({ at: "home" });
  const [useEurope, setUseEurope] = useState(true);
  const [useJanuary, setUseJanuary] = useState(false);
  const [useGaffers, setUseGaffers] = useState(true);

  const { pool, loading } = usePool(screen.at === "home" ? null : screen.config.league);

  if (error) {
    return <div className="shell"><div className="loading">Could not reach the server: {error}</div></div>;
  }
  if (!leagues) {
    return <div className="shell"><div className="loading">Loading archives…</div></div>;
  }

  const totals = leagues.reduce(
    (acc, l) => ({
      clubSeasons: acc.clubSeasons + l.clubSeasons,
      players: acc.players + l.players,
      seasons: Math.max(acc.seasons, l.seasons),
    }),
    { clubSeasons: 0, players: 0, seasons: 0 },
  );
  const span = leagues[0] ? `${leagues[0].firstSeason}–${leagues[0].lastSeason}` : "";

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => setScreen({ at: "home" })}>
          Perfect<em>XI</em> <span>Big Five Draft</span>
        </button>
        {screen.at !== "home" && (
          <div className="topbar-actions">
            <button className="btn" onClick={() => setScreen({ at: "home" })}>⌂ Home</button>
          </div>
        )}
      </header>

      {screen.at === "home" && (
        <>
          <div className="hero">
            <div className="eyebrow">Unofficial fan draft game</div>
            <h1>Perfect<em>XI</em></h1>
            <p>
              Spin for a real club and season. Draft one player from that squad. Fill your eleven,
              then play out a full season in England, Spain, Germany, Italy or France — and see if
              anyone can beat you.
            </p>
            <div className="stat-strip" title={span}>
              <div><strong>5</strong><span>Leagues</span></div>
              <div><strong>{totals.clubSeasons.toLocaleString()}</strong><span>Club-seasons</span></div>
              <div><strong>{totals.players.toLocaleString()}</strong><span>Player seasons</span></div>
              <div><strong>{totals.seasons}</strong><span>Seasons each</span></div>
            </div>
          </div>

          <Setup
            leagues={leagues}
            onStart={(config) => setScreen({ at: "draft", config })}
          />

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Advanced</span>
              <div className="chip-grid">
                <button className="chip chip-tall" aria-pressed={useGaffers} onClick={() => setUseGaffers(!useGaffers)}>
                  <strong>Gaffers {useGaffers ? "on" : "off"}</strong>
                  <small>Appoint a manager after the draft. Their style shifts your side.</small>
                </button>
                <button className="chip chip-tall" aria-pressed={useEurope} onClick={() => setUseEurope(!useEurope)}>
                  <strong>European nights {useEurope ? "on" : "off"}</strong>
                  <small>Finish in the top seven and your XI plays on in Europe.</small>
                </button>
                <button className="chip chip-tall" aria-pressed={useJanuary} onClick={() => setUseJanuary(!useJanuary)}>
                  <strong>January window {useJanuary ? "on" : "off"}</strong>
                  <small>One gamble at halfway. It can help or hurt. No undo.</small>
                </button>
              </div>
            </div>
          </div>

          <div className="how">
            {[
              ["1", "Spin the wheel", "Each spin lands on a real club from a real season of your chosen league."],
              ["2", "Draft a player", "Take one player from that squad and slot them into your formation."],
              ["3", "Build your XI", "Repeat until all eleven positions are filled. Nobody can be picked twice."],
              ["4", "Play the season", "Take the weakest club's place in a real season and simulate every game."],
            ].map(([n, title, body]) => (
              <div key={n}>
                <b>{n}</b>
                <strong>{title}</strong>
                <p>{body}</p>
              </div>
            ))}
          </div>

          <p className="footnote">
            Perfect XI is an independent fan-made football draft and season simulator. It is not
            affiliated with, endorsed by or licensed by any club, competition, league, player
            association or governing body. Club and player names, ratings and statistics are used
            for descriptive and editorial purposes only. No crests, kits, photographs or other
            official branding are used.
          </p>
        </>
      )}

      {screen.at !== "home" && loading && (
        <div className="loading">Loading the {LEAGUES[screen.config.league].country} archive…</div>
      )}

      {screen.at === "draft" && pool && !loading && (
        <Draft
          config={screen.config}
          pool={pool}
          onRestart={() => setScreen({ at: "home" })}
          onComplete={(picks) =>
            setScreen(
              useGaffers
                ? { at: "gaffer", config: screen.config, picks }
                : { at: "result", config: screen.config, picks, gaffer: null, runSeed: screen.config.seed },
            )
          }
        />
      )}

      {screen.at === "gaffer" && (
        <div className="panel">
          <div className="eyebrow" style={{ textAlign: "center" }}>Your XI is complete</div>
          <h2 style={{ fontFamily: "var(--display)", fontSize: 40, textAlign: "center", margin: "0 0 6px", textTransform: "uppercase" }}>
            Appoint a gaffer
          </h2>
          <p className="field-note" style={{ textAlign: "center", marginBottom: 22 }}>
            Their style nudges how your side plays across the whole season. Choose carefully.
          </p>
          <div className="chip-grid">
            {GAFFERS.map((g) => (
              <button
                key={g.id}
                className="chip chip-tall"
                onClick={() =>
                  setScreen({
                    at: "result", config: screen.config, picks: screen.picks,
                    gaffer: g, runSeed: screen.config.seed,
                  })
                }
              >
                <strong>{g.name}</strong>
                <small>{g.style} · {g.blurb}</small>
                <small style={{ color: "var(--accent)" }}>
                  ATT {fmt(g.attack)} · DEF {fmt(g.defence)}
                </small>
              </button>
            ))}
          </div>
        </div>
      )}

      {screen.at === "result" && pool && !loading && (
        <Result
          picks={screen.picks}
          pool={pool}
          league={screen.config.league}
          playSeason={screen.config.playSeason}
          lens={screen.config.lens}
          seed={screen.runSeed}
          teamName={screen.config.teamName}
          gaffer={screen.gaffer}
          useJanuary={useJanuary}
          useEurope={useEurope}
          onRestart={() => setScreen({ at: "home" })}
          onReplay={() =>
            setScreen({ ...screen, runSeed: `${screen.config.seed}:${Math.floor(Math.random() * 1e9)}` })
          }
        />
      )}
    </div>
  );
}

const fmt = (v: number) => `${v >= 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`;
