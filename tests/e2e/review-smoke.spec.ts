import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Smoke: upload → worker + AI (stub) → review beside the source → correct → approve → export (ERP mock).
test("a clerk uploads a request, reviews it beside its source, corrects a value, approves and it is exported", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("sachbearbeitung@musterbau.example.com");
  await page.getByLabel("Passwort").fill(process.env.SEED_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Rolle: Sachbearbeitung")).toBeVisible();

  await page.goto("/requests");
  const subject = `Anfrage Flansche DN 100 (E2E ${randomUUID().slice(0, 8)})`;
  const mail = [
    "From: Einkauf <einkauf@example.com>",
    "To: Vertrieb <vertrieb@example.org>",
    `Subject: ${subject}`,
    `Message-ID: <${randomUUID()}@example.com>`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Musterbau Beispiel GmbH",
    "Ansprechpartnerin: Erika Beispiel",
    "Liefertermin: 15.10.2026",
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

  await expect(page.getByTestId("value-contact_person")).toHaveText("Erika Beispiel");
  await page.getByRole("row", { name: /Ansprechpartner/ }).getByRole("link", { name: "Quelle anzeigen" }).click();
  await expect(page.locator("mark")).toHaveText("Erika Beispiel");

  const companyRow = page.getByRole("row", { name: /Firma/ });
  await companyRow.getByLabel("Neuer Wert für Firma").fill("Musterbau Beispiel GmbH & Co. KG");
  await companyRow.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Korrektur gespeichert.");
  await expect(page.getByTestId("value-company")).toContainText("Musterbau Beispiel GmbH & Co. KG");

  await page.getByRole("button", { name: "Freigeben" }).click();
  // The worker may already have exported it by the time the page renders.
  await expect(page.getByTestId("request-status")).toHaveText(/^(Freigegeben|Exportiert)$/);

  // The worker exports the approved request to the ERP mock exactly once (#9).
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("request-status")).toHaveText("Exportiert", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("erp-reference")).toHaveText(/^QR-[0-9A-F]{10}$/);
});
