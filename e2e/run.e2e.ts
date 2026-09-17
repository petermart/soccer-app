/**
 * A whole run, played in a browser: draft eleven, roll a gaffer, watch the
 * season, take the January window, read the final table.
 */
import { expect, test } from "@playwright/test";
import {
  chooseFormation, chooseLeague, completeDraft, openGame, rollGaffer,
  setToggle, startDraft,
} from "./helpers.ts";

test("plays a full season through to the result screen", async ({ page }) => {
  await openGame(page, "E2EFULL1");
  await chooseLeague(page, "eng");
  await chooseFormation(page, "4-3-3");
  await setToggle(page, "toggle-gaffers", true);
  await setToggle(page, "toggle-january", true);
  await startDraft(page);

  await completeDraft(page);
  const gaffer = await rollGaffer(page);
  expect(gaffer.length).toBeGreaterThan(3);

  // The season plays out matchday by matchday.
  const live = page.getByTestId("season-live");
  await expect(live).toBeVisible();
  await expect(page.getByTestId("live-round")).toContainText("Matchday");
  await expect(page.getByTestId("match").first()).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("skip-ahead").click();

  // Halfway, the window opens and asks rather than deciding for you.
  const prompt = page.getByTestId("january-prompt");
  await expect(prompt).toBeVisible();
  await page.getByTestId("january-roll").click();
  await expect(page.getByTestId("january-result")).toBeVisible();
  await page.getByTestId("second-half").click();

  await page.getByTestId("skip-ahead").click();

  // Full time.
  const result = page.getByTestId("season-result");
  await expect(result).toBeVisible({ timeout: 30_000 });

  const record = await page.getByTestId("final-record").innerText();
  const [won, drawn, lost] = record.split("-").map((n) => Number(n.trim()));
  const games = won! + drawn! + lost!;

  const rows = page.getByTestId("final-table").locator("tbody tr");
  const teams = await rows.count();
  expect(teams).toBe(20);
  expect(games).toBe(2 * (teams - 1)); // season length follows the real field

  // Your row in the table has to agree with the hero scoreline.
  const you = rows.locator("tr.you").or(page.locator('[data-testid="final-table"] tr.you'));
  const cells = await you.first().locator("td").allInnerTexts();
  expect(Number(cells[2])).toBe(games);
  expect(Number(cells[3])).toBe(won);
  expect(Number(cells[4])).toBe(drawn);
  expect(Number(cells[5])).toBe(lost);
  expect(Number(cells[7])).toBe(won! * 3 + drawn!);

  // Every match is listed, and the goals in them are the goals in the table.
  const matches = page.getByTestId("all-results").getByTestId("match");
  expect(await matches.count()).toBe(games);

  const totals = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="all-results"] [data-testid="match"]')];
    return {
      gf: cards.reduce((s, c) => s + Number((c as HTMLElement).dataset.gf), 0),
      ga: cards.reduce((s, c) => s + Number((c as HTMLElement).dataset.ga), 0),
      listed: cards.reduce(
        (s, c) => s + [...c.querySelectorAll(".scorer")].reduce((n, x) => n + Number((x as HTMLElement).dataset.goals), 0),
        0,
      ),
      scorerTable: [...document.querySelectorAll('[data-testid="scorers"] tbody tr')]
        .reduce((s, r) => s + Number(r.children[1]!.textContent), 0),
    };
  });
  expect(totals.listed).toBe(totals.gf);
  expect(totals.scorerTable).toBe(totals.gf);
  expect(Number(cells[6]!.replace("+", ""))).toBe(totals.gf - totals.ga);
});

test("the same run code replays the same season", async ({ page }) => {
  const play = async () => {
    await openGame(page, "E2ESEED9");
    await chooseLeague(page, "ita");
    await setToggle(page, "toggle-gaffers", true);
    await setToggle(page, "toggle-january", false);
    await startDraft(page);
    await completeDraft(page);
    const gaffer = await rollGaffer(page);
    await page.getByTestId("skip-ahead").click();
    await expect(page.getByTestId("season-result")).toBeVisible({ timeout: 30_000 });
    return {
      gaffer,
      record: await page.getByTestId("final-record").innerText(),
      xi: await page.locator(".xi-row").allInnerTexts(),
      results: await page.getByTestId("all-results").getByTestId("match").allInnerTexts(),
    };
  };

  const first = await play();
  const second = await play();
  expect(second.gaffer).toBe(first.gaffer);
  expect(second.xi).toEqual(first.xi);
  expect(second.record).toBe(first.record);
  expect(second.results).toEqual(first.results);
});

test("skipping the January window leaves the XI alone", async ({ page }) => {
  await openGame(page, "E2ESKIP2");
  await chooseLeague(page, "fra");
  await setToggle(page, "toggle-january", true);
  await startDraft(page);
  await completeDraft(page);
  await rollGaffer(page);

  await page.getByTestId("skip-ahead").click();
  await expect(page.getByTestId("january-prompt")).toBeVisible();
  await page.getByTestId("january-skip").click();
  await page.getByTestId("skip-ahead").click();

  await expect(page.getByTestId("season-result")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("january-summary")).toBeHidden();
  await expect(page.locator(".xi-row", { hasText: "signed in January" })).toHaveCount(0);
});

test("European nights are gone", async ({ page }) => {
  await openGame(page, "E2ENOEUR");
  await expect(page.getByText("European nights")).toHaveCount(0);
  await chooseLeague(page, "ger");
  await setToggle(page, "toggle-january", false);
  await startDraft(page);
  await completeDraft(page);
  await rollGaffer(page);
  await page.getByTestId("skip-ahead").click();
  await expect(page.getByTestId("season-result")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/European|Champions League run|cup tie/i)).toHaveCount(0);
});

test("Germany runs 18 clubs, so the perfect target is 34-0", async ({ page }) => {
  await openGame(page, "E2EGER18");
  await chooseLeague(page, "ger");
  await setToggle(page, "toggle-january", false);
  await expect(page.locator(".field-note", { hasText: "perfect record" })).toContainText("34-0");

  await startDraft(page);
  await completeDraft(page);
  await rollGaffer(page);
  await page.getByTestId("skip-ahead").click();
  await expect(page.getByTestId("season-result")).toBeVisible({ timeout: 30_000 });

  const rows = await page.getByTestId("final-table").locator("tbody tr").count();
  expect(rows).toBe(18);
  const record = await page.getByTestId("final-record").innerText();
  expect(record.split("-").map(Number).reduce((a, b) => a + b, 0)).toBe(34);
});
