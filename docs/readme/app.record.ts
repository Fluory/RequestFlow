import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Screen recordings of the README, taken from the running app (see record.config.ts): every frame is a
// screenshot of the real page. Between two actions a drawn pointer moves to the next control in a fixed
// number of frames, and pauses are repeated frames – so the films do not depend on how fast the machine
// is, only on what the app shows. All mails, companies and people are synthetic.
//   pnpm build && pnpm exec playwright test -c docs/readme/record.config.ts
const here = fileURLToPath(new URL(".", import.meta.url));
const FPS = 12;
const VIEWPORT = { width: 1280, height: 860 };

test.use({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: "de-DE", timezoneId: "Europe/Berlin" });

class Reel {
  private dir = mkdtempSync(join(tmpdir(), "rf-reel-"));
  private count = 0;
  private pointer = { x: VIEWPORT.width / 2, y: VIEWPORT.height - 60 };

  constructor(
    private page: Page,
    private file: string,
  ) {}

  /** One frame (plus `hold` repeats) of the page as it is now, with the pointer drawn on top. */
  async snap(hold = 0, pressed = false): Promise<void> {
    await this.page.evaluate(
      ({ x, y, pressed }) => {
        let cursor = document.getElementById("readme-pointer");
        if (!cursor) {
          cursor = document.createElement("div");
          cursor.id = "readme-pointer";
          cursor.innerHTML =
            '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 20 L7 15.5 L10.5 23.5 L13.5 22 L10 14.5 L17 14.5 Z" fill="#1d1c1a" stroke="#fffefb" stroke-width="1.6" stroke-linejoin="round"/></svg>';
          cursor.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;";
          document.body.appendChild(cursor);
        }
        cursor.style.transform = `translate(${x - 2}px, ${y - 2}px) scale(${pressed ? 0.85 : 1})`;
      },
      { ...this.pointer, pressed },
    );
    const first = join(this.dir, `${String(this.count++).padStart(4, "0")}.png`);
    await this.page.screenshot({ path: first, caret: "initial", animations: "disabled" });
    for (let i = 0; i < hold; i++) copyFileSync(first, join(this.dir, `${String(this.count++).padStart(4, "0")}.png`));
  }

  async pause(seconds: number): Promise<void> {
    await this.snap(Math.max(0, Math.round(seconds * FPS) - 1));
  }

  async moveTo(target: Locator, { frames = 9, below = 0 } = {}): Promise<void> {
    let box = await target.boundingBox();
    if (!box) throw new Error("target not visible");
    // Off screen: scroll smoothly until the target sits in the middle, as a person would.
    if (box.y < 80 || box.y + box.height > VIEWPORT.height - 20) {
      const top = await this.page.evaluate(() => window.scrollY);
      await this.scrollTo(Math.max(0, top + box.y - VIEWPORT.height / 2));
      box = await target.boundingBox();
      if (!box) throw new Error("target not visible");
    }
    const from = { ...this.pointer };
    const to = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 + below };
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.pointer = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease };
      await this.snap();
    }
  }

  async click(target: Locator): Promise<void> {
    await this.moveTo(target);
    await this.snap(2, true);
    await target.click();
    // The page may scroll (source links jump to their line): the pointer stays on what it clicked.
    const box = await target.boundingBox({ timeout: 500 }).catch(() => null);
    if (box) this.pointer = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 };
  }

  /** Smooth page scroll to `y` in a fixed number of frames. */
  async scrollTo(y: number, frames = 10): Promise<void> {
    const from = await this.page.evaluate(() => window.scrollY);
    for (let i = 1; i <= frames; i++) {
      const t = i / frames;
      const ease = 1 - (1 - t) ** 3;
      await this.page.evaluate((top) => window.scrollTo(0, top), Math.round(from + (y - from) * ease));
      await this.snap();
    }
  }

  save(quality = 82): void {
    const result = spawnSync("python3", [join(here, "webp.py"), this.dir, join(here, this.file), String(FPS), String(quality)], { stdio: "inherit" });
    rmSync(this.dir, { recursive: true, force: true });
    if (result.status !== 0) throw new Error(`webp.py failed for ${this.file}`);
  }
}

/** Reloads until the request has the expected status – the worker processes in the background. */
async function waitForStatus(page: Page, status: string): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("request-status")).toHaveText(status, { timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
}

test("upload: a request mail is read, every value keeps its source line", async ({ page }) => {
  // Staff account of the seeded synthetic company; the AI service is the stub of the E2E smoke flows
  // (tests/e2e/ai-stub.mjs) – it quotes the lines it recognises, so the mail follows its patterns.
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("sachbearbeitung@musterbau.example.com");
  await page.getByLabel("Passwort").fill(process.env.SEED_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Rolle: Sachbearbeitung")).toBeVisible();
  await page.goto("/requests");

  const reel = new Reel(page, "upload.webp");
  await reel.pause(0.8);
  const id = Date.now().toString(36).slice(-4).toUpperCase();
  const subject = `Anfrage Flansche DN 100 fuer Halle 3 (${id})`;
  const mail = [
    "From: Einkauf <einkauf@nordwerk.example.com>",
    "To: Vertrieb <vertrieb@example.org>",
    `Subject: ${subject}`,
    `Message-ID: <readme-${id}@nordwerk.example.com>`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Guten Tag,",
    "bitte senden Sie uns ein Angebot.",
    "Pos. 1: 40 Stk. Vorschweissflansch DN 100 PN 16",
    "Pos. 2: 40 Stk. Flachdichtung DN 100",
    "Liefertermin: 15.10.2026",
    "Ansprechpartner: Max Beispiel",
    "Nordwerk Beispiel GmbH",
    "",
  ].join("\r\n");
  const input = page.getByLabel(/E-Mail \(\.eml, \.msg\)/);
  await reel.moveTo(input);
  await input.setInputFiles({ name: "anfrage-halle-3.eml", mimeType: "message/rfc822", buffer: Buffer.from(mail) });
  await reel.pause(0.6);
  await reel.click(page.getByRole("button", { name: "Anfrage hochladen" }));
  await expect(page.getByRole("status")).toContainText("Anfrage angelegt");
  await reel.pause(1.2);

  await page.getByRole("link", { name: subject, exact: true }).waitFor();
  await reel.click(page.getByRole("link", { name: subject, exact: true }));
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}/);
  await waitForStatus(page, "Zur Prüfung");
  await reel.pause(1.2);
  await reel.click(page.getByRole("link", { name: "Quelle anzeigen für Ansprechpartner" }));
  await expect(page.locator("mark")).toHaveText("Max Beispiel");
  await reel.pause(1.4);
  await reel.click(page.getByRole("link", { name: "Quelle anzeigen für Gewünschter Liefertermin" }));
  await expect(page.locator("mark")).toHaveText("15.10.2026");
  await reel.pause(1.8);
  reel.save();
});

test("demo: a guest reviews the prepared sample beside its source, approves it and it is exported once", async ({ page }) => {
  await page.goto("/");
  const review = new Reel(page, "review.webp");
  await review.pause(0.8);
  await review.click(page.getByRole("button", { name: "Ohne Anmeldung ausprobieren" }));
  await expect(page.getByTestId("next-step")).toBeVisible();
  await review.pause(0.8);
  await review.click(page.getByTestId("next-step").getByRole("link"));
  const sample = page.getByRole("link", { name: "Anfrage Rohrbogen und Flansche fuer Werk Ost", exact: true }).first();
  await sample.waitFor();
  await review.pause(0.6);
  await review.click(sample);
  await expect(page.getByTestId("sample-notice")).toBeVisible();
  await review.pause(1);
  await review.click(page.getByRole("link", { name: "Quelle anzeigen für Ansprechpartner" }));
  await expect(page.locator("mark")).toHaveText("Jana Beispiel");
  await review.pause(1.3);
  await review.click(page.getByRole("link", { name: "Quelle anzeigen für Gewünschter Liefertermin" }));
  await expect(page.locator("mark")).toHaveText("KW 48");
  await review.pause(1.8);
  review.save();

  // The same guest company continues: approve → the worker exports it exactly once.
  const exported = new Reel(page, "export.webp");
  await exported.pause(0.6);
  const approve = page.getByRole("button", { name: "Freigeben" });
  await exported.click(approve);
  await expect(page.getByTestId("request-status")).toHaveText(/^(Freigegeben|Exportiert)$/);
  await exported.pause(1);
  await waitForStatus(page, "Exportiert");
  await page.evaluate(() => window.scrollTo(0, 0));
  await exported.pause(0.6);
  await exported.moveTo(page.getByTestId("erp-reference"), { below: 26 });
  await exported.pause(2.2);
  exported.save();
});
