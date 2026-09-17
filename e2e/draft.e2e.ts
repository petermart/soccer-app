/**
 * Draft rules in the browser: who may fill a slot, moving players once
 * drafted, and the pitch holding still while it fills up.
 */
import { expect, test } from "@playwright/test";
import {
  badgeCentre, chooseFormation, chooseLeague, openGame, slot, slotState,
  spinAndPick, startDraft,
} from "./helpers.ts";

test("a player is only offered positions they have played", async ({ page }) => {
  await openGame(page, "E2EPOS11");
  await chooseLeague(page, "esp");
  await startDraft(page);

  for (let i = 0; i < 4; i++) {
    await page.getByTestId("spin").click();
    await expect(page.getByTestId("player-choice").first()).toBeVisible();

    const rows = await page.getByTestId("player-choice").evaluateAll((els) =>
      els.map((el) => ({
        fits: ((el as HTMLElement).dataset.fits ?? "").split(",").filter(Boolean),
        positions: ((el as HTMLElement).dataset.positions ?? "").split(",").filter(Boolean),
        tags: [...el.querySelectorAll(".pos-tag")].map((t) => t.textContent!.trim()),
      })),
    );
    expect(rows.length).toBeGreaterThan(0);

    const open = await page.getByTestId("pitch").evaluateAll((els) =>
      [...els[0]!.querySelectorAll('[data-filled="false"]')].map((e) => (e as HTMLElement).dataset.slot!),
    );

    for (const row of rows) {
      expect(row.fits.length).toBeGreaterThan(0);
      for (const fit of row.fits) {
        // Every offered slot is one they can play and is currently empty.
        expect(row.positions).toContain(fit);
        expect(open).toContain(fit);
      }
      // The tags on the row are their career positions, nothing invented.
      for (const tag of row.tags) expect(row.positions).toContain(tag);
    }

    await page.getByTestId("player-choice").first().click();
    const modal = page.getByTestId("slot-modal");
    if (await modal.isVisible().catch(() => false)) {
      await modal.getByTestId("slot-option").first().click();
    }
  }
});

test("filling a position blocks players who only play there", async ({ page }) => {
  await openGame(page, "E2EBLOCK3");
  await chooseLeague(page, "eng");
  await startDraft(page);

  // Draft a keeper first: that is the one slot every squad competes for.
  await page.getByTestId("spin").click();
  const keeper = page.getByTestId("player-choice").filter({ has: page.locator('.pos-tag:text-is("GK")') }).first();
  if (await keeper.isVisible().catch(() => false)) {
    await keeper.click();
  } else {
    await page.getByTestId("player-choice").first().click();
    const modal = page.getByTestId("slot-modal");
    if (await modal.isVisible().catch(() => false)) await modal.getByTestId("slot-option").first().click();
  }

  // Spin on until a squad turns up someone whose positions are all taken.
  let sawBlocked = false;
  for (let i = 0; i < 8 && !sawBlocked; i++) {
    if (!(await page.getByTestId("spin").isVisible().catch(() => false))) break;
    await page.getByTestId("spin").click();
    await expect(page.getByTestId("player-choice").first()).toBeVisible();

    const blocked = page.getByTestId("player-blocked");
    if (await blocked.count()) {
      sawBlocked = true;
      await expect(page.locator(".list-divider")).toContainText("move someone to make room");

      const offered = await page.getByTestId("player-choice").evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).dataset.pid),
      );
      const rows = await blocked.evaluateAll((els) =>
        els.map((e) => ({ pid: (e as HTMLElement).dataset.pid, by: (e as HTMLElement).dataset.blockedBy })),
      );
      for (const row of rows) {
        expect(offered).not.toContain(row.pid); // blocked players cannot be taken
        expect(row.by!.length).toBeGreaterThan(0);
      }
      // A blocked row is not clickable into the XI.
      const before = await page.getByTestId("open-count").innerText();
      await blocked.first().click({ force: true });
      await expect(page.getByTestId("open-count")).toHaveText(before);
      break;
    }

    await page.getByTestId("player-choice").first().click();
    const modal = page.getByTestId("slot-modal");
    if (await modal.isVisible().catch(() => false)) await modal.getByTestId("slot-option").first().click();
  }
  expect(sawBlocked).toBe(true);
});

test("a drafted player can be moved, and only to somewhere they play", async ({ page }) => {
  await openGame(page, "E2EMOVE42");
  await chooseLeague(page, "esp");
  await chooseFormation(page, "4-3-3");
  await startDraft(page);

  // Draft a few players who list more than one position.
  for (let i = 0; i < 4; i++) {
    await spinAndPick(page, async (rows) => {
      const positions = await rows.evaluateAll((els) =>
        els.map((e) => ((e as HTMLElement).dataset.positions ?? "").split(",").length),
      );
      const multi = positions.findIndex((n) => n > 1);
      return multi === -1 ? 0 : multi;
    });
  }

  const filled = await page.getByTestId("pitch").evaluate((pitch) =>
    [...pitch.querySelectorAll('[data-filled="true"]')].map((e) => ({
      index: Number((e as HTMLElement).dataset.testid!.split("-")[1]),
      slot: (e as HTMLElement).dataset.slot,
      pid: (e as HTMLElement).dataset.pid,
    })),
  );
  expect(filled.length).toBeGreaterThan(0);

  // Pick one up and see what is offered.
  let moved = false;
  for (const pick of filled) {
    await slot(page, pick.index).click();
    const hint = page.getByTestId("pitch-hint");
    if (!(await hint.innerText()).startsWith("Moving")) continue;

    const targets = await page.getByTestId("pitch").evaluate((pitch) =>
      [...pitch.querySelectorAll(".slot.targetable")].map((e) => ({
        index: Number((e as HTMLElement).dataset.testid!.split("-")[1]),
        slot: (e as HTMLElement).dataset.slot,
        filled: (e as HTMLElement).dataset.filled === "true",
      })),
    );
    if (!targets.length) continue;

    const positions = await page.evaluate(
      (pid) => {
        const row = document.querySelector(`[data-testid="player-choice"][data-pid="${pid}"]`) as HTMLElement | null;
        return row?.dataset.positions ?? null;
      },
      pick.pid,
    );
    // Every offered destination is a position this player actually plays.
    for (const target of targets) {
      if (positions) expect(positions.split(",")).toContain(target.slot!);
    }

    const empty = targets.find((t) => !t.filled);
    if (!empty) continue;
    await slot(page, empty.index).click();

    const from = await slotState(page, pick.index);
    const to = await slotState(page, empty.index);
    expect(from.filled).toBe(false);     // the old slot is free again
    expect(to.pid).toBe(pick.pid!);      // and they are in the new one
    moved = true;
    break;
  }
  expect(moved).toBe(true);
});

test("filling a slot does not shift it up the pitch", async ({ page }) => {
  await openGame(page, "E2EPITCH7");
  await chooseLeague(page, "eng");
  await chooseFormation(page, "4-2-3-1");
  await startDraft(page);

  const before = [];
  for (let i = 0; i < 11; i++) before.push(await badgeCentre(page, i));

  for (let picks = 0; picks < 5; picks++) {
    await spinAndPick(page);
    for (let i = 0; i < 11; i++) {
      const now = await badgeCentre(page, i);
      // Badges stay on their formation coordinate, filled or not.
      expect(Math.abs(now.x - before[i]!.x)).toBeLessThan(1);
      expect(Math.abs(now.y - before[i]!.y)).toBeLessThan(1);
    }
  }
});

test("position-first mode spins only for the slot you chose", async ({ page }) => {
  await openGame(page, "E2EPOSFIRST");
  await chooseLeague(page, "ita");
  await page.getByRole("button", { name: /Position first/ }).click();
  await startDraft(page);

  await expect(page.getByText("Pick a position")).toBeVisible();
  await slot(page, 9).click();
  const wanted = (await slot(page, 9).getAttribute("data-slot"))!;
  await expect(page.getByTestId("spin")).toBeVisible();

  await page.getByTestId("spin").click();
  await expect(page.getByTestId("player-choice").first()).toBeVisible();
  const fits = await page.getByTestId("player-choice").evaluateAll((els) =>
    els.map((e) => (e as HTMLElement).dataset.fits),
  );
  for (const f of fits) expect(f).toBe(wanted);
});
