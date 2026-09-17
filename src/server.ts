/**
 * Bun full-stack server. Bundles the React client from the HTML import and
 * serves the league archives as static JSON.
 */
import index from "./index.html";
import { LEAGUE_ORDER, LEAGUES, type LeagueId } from "./engine/leagues.ts";
import manifest from "./data/manifest.json" with { type: "json" };

const isLeague = (v: string): v is LeagueId => (LEAGUE_ORDER as string[]).includes(v);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3838),
  development: process.env.NODE_ENV !== "production",

  routes: {
    "/api/leagues": () =>
      Response.json(
        manifest.map((m) => {
          const cfg = LEAGUES[m.id as LeagueId];
          return { ...m, code: cfg.code, accent: cfg.accent };
        }),
      ),

    "/api/league/:id": async (req) => {
      const { id } = req.params;
      if (!isLeague(id)) return new Response("Unknown league", { status: 404 });
      const file = Bun.file(new URL(`./data/${id}.json`, import.meta.url));
      if (!(await file.exists())) {
        return new Response("Archive missing — run `bun run build:data`", { status: 503 });
      }
      return new Response(file, {
        headers: {
          "content-type": "application/json",
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    },

    "/api/health": () => Response.json({ ok: true, leagues: manifest.length }),

    "/*": index,
  },
});

console.log(`Perfect XI running at ${server.url}`);
