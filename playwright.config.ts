import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests play the real game in a real browser: draft an XI, roll a
 * gaffer, watch the season out, take the January window.
 *
 * They run against their own server on a separate port so a dev server can
 * stay up alongside them. Runs are driven by ?seed=, which pins every spin,
 * roll and scoreline.
 */
const PORT = Number(process.env.E2E_PORT ?? 3939);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Without a limit a miss waits for the whole test timeout, which turns a
    // small mistake into a mystery.
    actionTimeout: 10_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun src/server.ts`,
    env: { PORT: String(PORT), NODE_ENV: "production" },
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
