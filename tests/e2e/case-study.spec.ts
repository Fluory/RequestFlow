import { expect, test } from "@playwright/test";

// #75: the public case study is reachable without a session, shows static content only and leads through
// the login to the prepared sample (#71) from the global setup.
test("a visitor reads the case study without signing in and reaches the sample through the login", async ({ page }) => {
  const response = await page.goto("/case-study");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("genau einmal ans ERP");

  // No data access: the seeded sample's customer exists in the database but never appears here, and a
  // visitor without a session gets no app navigation.
  await expect(page.getByText("Beispiel Anlagenbau GmbH")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Hauptnavigation" })).toHaveCount(0);
  await expect(page.getByText("Synthetische Daten", { exact: false }).first()).toBeVisible();

  await expect(page.getByRole("link", { name: "Gemessene Nachweise" }).first()).toHaveAttribute("href", /\/docs\/product\/evidence\.md$/);
  await expect(page.getByRole("link", { name: "Quellcode auf GitHub" })).toHaveAttribute("href", "https://github.com/Fluory/RequestFlow");
  for (const shot of ["requests", "review", "exported"]) {
    const image = await page.request.get(`/case-study/${shot}.png`);
    expect(image.status(), `${shot}.png`).toBe(200);
  }

  await page.getByRole("link", { name: "Live-App öffnen" }).first().click();
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  await page.getByLabel("E-Mail").fill("sachbearbeitung@musterbau.example.com");
  await page.getByLabel("Passwort").fill(process.env.SEED_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden" }).click();

  // The start page's next step leads to the open review, where the sample waits.
  await page.getByTestId("next-step").getByRole("link").click();
  await page.getByRole("link", { name: "Anfrage Rohrbogen und Flansche fuer Werk Ost", exact: true }).first().click();
  await expect(page.getByTestId("sample-notice")).toContainText("Vorbereitetes Beispiel");
});
