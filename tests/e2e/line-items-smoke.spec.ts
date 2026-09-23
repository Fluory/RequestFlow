import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Smoke (#25): a multi-item request from upload to approval – items as a table, one item field checked
// beside its source and corrected, then approved and exported.
test("a clerk reviews a multi-item request, corrects a position and approves it", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("sachbearbeitung@musterbau.example.com");
  await page.getByLabel("Passwort").fill(process.env.SEED_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Rolle: Sachbearbeitung")).toBeVisible();

  await page.goto("/requests");
  const subject = `Anfrage Positionen (E2E ${randomUUID().slice(0, 8)})`;
  const mail = [
    "From: Einkauf <einkauf@example.com>",
    "To: Vertrieb <vertrieb@example.org>",
    `Subject: ${subject}`,
    `Message-ID: <${randomUUID()}@example.com>`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Musterbau Beispiel GmbH",
    "Ansprechpartnerin: Erika Beispiel",
    "Pos. 1: 1.250 Stk. Flansch DN 100",
    "Pos. 2: 40 Stk. Dichtung DN 100",
    "",
  ].join("\r\n");
  await page.getByLabel(/E-Mail \(\.eml, \.msg\)/).setInputFiles({ name: "anfrage.eml", mimeType: "message/rfc822", buffer: Buffer.from(mail) });
  await page.getByRole("button", { name: "Anfrage hochladen" }).click();
  await expect(page.getByRole("status")).toContainText("Anfrage angelegt");

  await page.getByRole("link", { name: subject }).click();
  await page.waitForURL(/\/requests\/[0-9a-f-]{36}/);
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("request-status")).toHaveText("Zur Prüfung", { timeout: 1_000 });
  }).toPass({ timeout: 60_000 });

  await expect(page.getByTestId("item-0-quantity")).toContainText("1250");
  await expect(page.getByTestId("item-1-description")).toContainText("Dichtung DN 100");
  await page.getByRole("link", { name: "Position 1, Menge: prüfen" }).click();
  await expect(page.locator("mark")).toHaveText("1.250");

  await page.getByLabel("Neuer Wert für Position 1, Menge").fill("1300");
  await page.getByRole("button", { name: "Speichern" }).last().click();
  await expect(page.getByRole("status")).toHaveText("Korrektur gespeichert.");
  await expect(page.getByTestId("item-0-quantity")).toContainText("1300");
  await expect(page.getByTestId("item-0-quantity")).toContainText("korrigiert");

  await page.getByRole("button", { name: "Freigeben" }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("request-status")).toHaveText("Exportiert", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
});
