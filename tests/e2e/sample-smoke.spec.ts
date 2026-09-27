import { expect, test } from "@playwright/test";

// Smoke (#71): the prepared samples from the global setup are labelled in list and detail, the review
// sample shows why a person must check, and the exported sample carries its ERP reference.
test("a visitor finds the prepared samples, clearly labelled, one to review and one exported", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("sachbearbeitung@musterbau.example.com");
  await page.getByLabel("Passwort").fill(process.env.SEED_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Rolle: Sachbearbeitung")).toBeVisible();

  await page.goto("/requests");
  const reviewRow = page.getByRole("row", { name: /Anfrage Rohrbogen und Flansche fuer Werk Ost/ }).first();
  await expect(reviewRow.getByTestId("sample-label")).toHaveText("Vorbereitetes Beispiel – aufgezeichnete KI-Antwort");

  await reviewRow.getByRole("link", { name: "Anfrage Rohrbogen und Flansche fuer Werk Ost" }).click();
  await expect(page.getByTestId("sample-notice")).toContainText("Vorbereitetes Beispiel – aufgezeichnete KI-Antwort");
  await expect(page.getByTestId("request-status")).toHaveText("Zur Prüfung");
  await expect(page.getByText(/braucht Aufmerksamkeit|brauchen Aufmerksamkeit/)).toBeVisible();

  await page.goto("/requests");
  await page.getByRole("link", { name: "Anfrage Dichtungssatz fuer Pumpe P-204" }).first().click();
  await expect(page.getByTestId("sample-notice")).toBeVisible();
  // Exported by the seed, or – when the ERP was not up yet during the setup – by the worker shortly after.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("request-status")).toHaveText("Exportiert", { timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByTestId("erp-reference")).toHaveText(/^QR-[0-9A-F]{10}$/);
});
