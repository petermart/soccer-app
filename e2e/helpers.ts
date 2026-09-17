import { expect, type Locator, type Page } from "@playwright/test";

/** Opens the game with a fixed run code, so a run is reproducible. */
export async function openGame(page: Page, seed: string) {
  await page.goto(`/?seed=${seed}`);
  await expect(page.getByTestId("start-draft")).toBeVisible();
}

export async function chooseLeague(page: Page, league: "eng" | "esp" | "ger" | "ita" | "fra") {
  await page.locator(`[data-testid="league-card"][data-league="${league}"]`).click();
}

export async function chooseFormation(page: Page, formation: string) {
  await page.locator(`[data-testid="formation-chip"][data-formation="${formation}"]`).click();
}

/** Turns an Advanced toggle on or off by reading its pressed state. */
export async function setToggle(page: Page, id: "toggle-gaffers" | "toggle-january", on: boolean) {
  const chip = page.getByTestId(id);
  if ((await chip.getAttribute("aria-pressed")) !== String(on)) await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", String(on));
}

export async function startDraft(page: Page) {
  await page.getByTestId("start-draft").click();
  // The archive has to load first. In position-first mode there is no spin
  // button until a slot has been chosen, so wait for the pitch itself.
  await expect(page.getByTestId("pitch")).toBeVisible({ timeout: 30_000 });
}

/** Spins, then takes one player. Returns what was taken. */
export async function spinAndPick(
  page: Page,
  choose: (rows: Locator) => Promise<number> = async () => 0,
) {
  await page.getByTestId("spin").click();
  const list = page.getByTestId("player-list");
  await expect(list).toBeVisible();
  const rows = page.getByTestId("player-choice");
  await expect(rows.first()).toBeVisible();

  const index = await choose(rows);
  const row = rows.nth(index);
  const name = await row.locator("strong").innerText();
  const fits = (await row.getAttribute("data-fits")) ?? "";
  const positions = (await row.getAttribute("data-positions")) ?? "";
  await row.click();

  // Multi-slot players ask where they should play.
  const modal = page.getByTestId("slot-modal");
  if (await modal.isVisible().catch(() => false)) {
    await modal.getByTestId("slot-option").first().click();
  }
  return { name, fits: fits.split(",").filter(Boolean), positions: positions.split(",").filter(Boolean) };
}

/** Drafts until the XI is full. */
export async function completeDraft(page: Page) {
  for (let i = 0; i < 11; i++) {
    if (!(await page.getByTestId("spin").isVisible().catch(() => false))) break;
    await spinAndPick(page);
  }
  await expect(page.getByTestId("open-count").or(page.getByTestId("gaffer-panel"))).toBeVisible();
}

export async function rollGaffer(page: Page) {
  await expect(page.getByTestId("gaffer-panel")).toBeVisible();
  await page.getByTestId("roll-gaffer").click();
  const kickOff = page.getByTestId("kick-off");
  await expect(kickOff).toBeVisible();
  const gaffer = await page.getByTestId("gaffer-name").innerText();
  await kickOff.click();
  return gaffer;
}

/** The on-pitch centre of a slot's badge, relative to the pitch itself. */
export async function badgeCentre(page: Page, slotIndex: number) {
  return page.evaluate((i) => {
    const pitch = document.querySelector('[data-testid="pitch"]')!.getBoundingClientRect();
    const badge = document
      .querySelector(`[data-testid="slot-${i}"] .slot-badge`)!
      .getBoundingClientRect();
    return {
      x: +(badge.x + badge.width / 2 - pitch.x).toFixed(1),
      y: +(badge.y + badge.height / 2 - pitch.y).toFixed(1),
    };
  }, slotIndex);
}

export const slot = (page: Page, index: number) => page.getByTestId(`slot-${index}`);

export async function slotState(page: Page, index: number) {
  const el = slot(page, index);
  return {
    slot: await el.getAttribute("data-slot"),
    pid: await el.getAttribute("data-pid"),
    filled: (await el.getAttribute("data-filled")) === "true",
    // An empty slot has no name element, so this must not wait for one.
    name: await el.locator(".slot-name").innerText({ timeout: 1000 }).catch(() => null),
  };
}
