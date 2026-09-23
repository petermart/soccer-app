import { useEffect, useRef, useState } from "react";
import type { DraftConfig } from "../engine/draft.ts";
import { GAFFERS, rollGaffer, type Gaffer } from "../engine/extras.ts";
import { LEAGUES } from "../engine/leagues.ts";
import type { Pick } from "../engine/ratings.ts";
import { Draft } from "./Draft.tsx";
import { Season } from "./Season.tsx";
import { Setup } from "./Setup.tsx";
import { useLeagueSummaries, usePool } from "./useArchive.ts";
import { Die } from "./icons.tsx";
import { useSettings } from "./useSettings.ts";

type Screen =
  | { at: "home" }
  | { at: "draft"; config: DraftConfig }
  | { at: "gaffer"; config: DraftConfig; picks: Pick[] }
  | { at: "season"; config: DraftConfig; picks: Pick[]; gaffer: Gaffer | null; runSeed: string };

export function App() {
  const { leagues, error } = useLeagueSummaries();
  const [screen, setScreen] = useState<Screen>({ at: "home" });
  const [settings, updateSettings, resetSettings] = useSettings();
  const useJanuary = settings.january;
  const useGaffers = settings.gaffers;
  const useEurope = settings.europe;

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
            settings={settings}
            onChange={updateSettings}
            onReset={resetSettings}
            onStart={(config) => setScreen({ at: "draft", config })}
          />

          <div className="panel" style={{ marginTop: 18 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Advanced</span>
              <div className="chip-grid">
                <button className="chip chip-tall" aria-pressed={useGaffers} onClick={() => updateSettings({ gaffers: !useGaffers })} data-testid="toggle-gaffers">
                  <strong>Gaffers {useGaffers ? "on" : "off"}</strong>
                  <small>Roll for a manager after the draft. Their style tilts how your side plays.</small>
                </button>
                <button className="chip chip-tall" aria-pressed={useJanuary} onClick={() => updateSettings({ january: !useJanuary })} data-testid="toggle-january">
                  <strong>January window {useJanuary ? "on" : "off"}</strong>
                  <small>At halfway, choose whether to roll for a transfer. Players can come in or go out.</small>
                </button>
                <button className="chip chip-tall" aria-pressed={useEurope} onClick={() => updateSettings({ europe: !useEurope })} data-testid="toggle-europe">
                  <strong>European nights {useEurope ? "on" : "off"}</strong>
                  <small>Finish top six and play the real European field: four to the Champions League, fifth Europa, sixth Conference.</small>
                </button>
              </div>
            </div>
          </div>

          <div className="how">
            {[
              ["1", "Spin the wheel", "Each spin lands on a real club from a real season of your chosen league."],
              ["2", "Draft a player", "Take one player from that squad and slot them into a position they really play."],
              ["3", "Build your XI", "Repeat until all eleven positions are filled. Move players around to make room."],
              ["4", "Play the season", "Take the weakest club's place in a real season and watch every matchday."],
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
                : { at: "season", config: screen.config, picks, gaffer: null, runSeed: screen.config.seed },
            )
          }
        />
      )}

      {screen.at === "gaffer" && (
        <GafferRoll
          seed={screen.config.seed}
          onDone={(gaffer) =>
            setScreen({ at: "season", config: screen.config, picks: screen.picks, gaffer, runSeed: screen.config.seed })
          }
        />
      )}

      {screen.at === "season" && pool && !loading && (
        <Season
          key={screen.runSeed}
          picks={screen.picks}
          pool={pool}
          config={screen.config}
          seed={screen.runSeed}
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

/** Rolls for a manager. You get who you get. */
function GafferRoll({ seed, onDone }: { seed: string; onDone: (g: Gaffer) => void }) {
  const [rolling, setRolling] = useState(false);
  const [reel, setReel] = useState<string | null>(null);
  const [gaffer, setGaffer] = useState<Gaffer | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const roll = () => {
    setRolling(true);
    let i = 0;
    timer.current = setInterval(() => setReel(GAFFERS[i++ % GAFFERS.length]!.name), 80);
    setTimeout(() => {
      if (timer.current) clearInterval(timer.current);
      setRolling(false);
      setReel(null);
      setGaffer(rollGaffer(seed));
    }, 1100);
  };

  return (
    <div className="panel gaffer-panel" data-testid="gaffer-panel">
      <div className="eyebrow" style={{ textAlign: "center" }}>Your XI is complete</div>
      <h2 className="panel-title">Roll for a gaffer</h2>
      <p className="field-note" style={{ textAlign: "center", marginBottom: 22 }}>
        The board appoints the manager, not you. Their style tilts how your side plays all season —
        some shut games down, some throw caution to the wind.
      </p>

      <div className="spin-stage">
        {!gaffer && <Die rolling={rolling} className="stage-die" />}
        <div className={`reel${rolling ? " spinning" : ""}`} data-testid="gaffer-name">
          {reel ?? gaffer?.name ?? "? ? ?"}
        </div>
        {gaffer && (
          <div className="gaffer-reveal">
            <strong>{gaffer.style}</strong>
            <p>{gaffer.blurb}</p>
            <p className="gaffer-effect">{describeStyle(gaffer)}</p>
          </div>
        )}
        {!gaffer ? (
          <button className="btn btn-primary btn-lg" onClick={roll} disabled={rolling} data-testid="roll-gaffer">
            <Die rolling={rolling} className="btn-die" />
            {rolling ? "Rolling…" : "Roll the dice"}
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={() => onDone(gaffer)} data-testid="kick-off">
            Kick off the season →
          </button>
        )}
      </div>
    </div>
  );
}

export function describeStyle(g: Gaffer): string {
  const pts = (v: number) => (v === 0 ? "±0" : `${v > 0 ? "+" : "−"}${Math.abs(v)}`);
  const tempo = Math.round((g.tempo - 1) * 100);
  const tempoText = tempo === 0 ? "normal tempo" : tempo > 0 ? `${tempo}% more goals in your games` : `${-tempo}% fewer goals in your games`;
  return `Attack ${pts(g.attack)} · Defence ${pts(g.defence)} · ${tempoText}`;
}
