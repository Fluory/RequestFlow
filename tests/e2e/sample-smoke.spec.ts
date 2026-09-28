import { expect, test } from "@playwright/test";

// Smoke (#71): the prepared samples from the global setup are labelled in list and detail, the review
// sample shows why a person must check, and the exported sample carries its ERP reference.
test("a visitor finds the prepared samples, clearly labelled, one to review and one exported", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("sachbearbeitung@musterbau.example.com");
  await page.getByLabel("Passwort").fill(process.env.SEED_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Rolle: Sachbearbeitung")).toBeVisible();

  // #77: the start page names the next step – here the open reviews (the sample waits in review).
  await expect(page.getByTestId("next-step")).toContainText("warte");
  await expect(page.getByTestId("next-step").getByRole("link", { name: "Jetzt prüfen" })).toBeVisible();

  // #77: the list leads with customer, need for review and next action – without sideways scrolling at 1280 px.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/requests");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  const tableWrap = page.getByTestId("requests-table-wrap");
  expect(await tableWrap.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
  const reviewRow = page.getByRole("row", { name: /Anfrage Rohrbogen und Flansche fuer Werk Ost/ }).first();
  await expect(reviewRow.getByTestId("sample-label")).toHaveText("Vorbereitetes Beispiel – aufgezeichnete KI-Antwort");
  await expect(reviewRow.getByTestId("request-customer")).toHaveText("Beispiel Anlagenbau GmbH");
  await expect(reviewRow.getByTestId("request-attention")).toContainText("1 Wert prüfen");
  await expect(reviewRow.getByTestId("request-next-action")).toContainText("Prüfen");
  // The diagnosis opens by keyboard and names its request (#77 review).
  const diagnosis = reviewRow.getByText("Details zu Anfrage Rohrbogen und Flansche fuer Werk Ost");
  await diagnosis.focus();
  await page.keyboard.press("Enter");
  await expect(reviewRow.getByText("Versuche")).toBeVisible();

  // Exact: the row also holds "Prüfen: <subject>" (#77).
  await reviewRow.getByRole("link", { name: "Anfrage Rohrbogen und Flansche fuer Werk Ost", exact: true }).click();
  await expect(page.getByTestId("sample-notice")).toContainText("Vorbereitetes Beispiel – aufgezeichnete KI-Antwort");
  await expect(page.getByTestId("request-status")).toHaveText("Zur Prüfung");
  await expect(page.getByText(/braucht Aufmerksamkeit|brauchen Aufmerksamkeit/)).toBeVisible();

  await page.goto("/requests");
  await page.getByRole("link", { name: "Anfrage Dichtungssatz fuer Pumpe P-204", exact: true }).first().click();
  await expect(page.getByTestId("sample-notice")).toBeVisible();
  // Exported by the seed, or – when the ERP was not up yet during the setup – by the worker shortly after.
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId("request-status")).toHaveText("Exportiert", { timeout: 1_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByTestId("erp-reference")).toHaveText(/^QR-[0-9A-F]{10}$/);
});
