import { expect, test, type Page } from "@playwright/test";

// The security headers (src/config/security-headers.ts) against the built app in a real browser: every
// page of the main flow loads, signs in, opens a request and navigates without a single CSP violation,
// and the headers are present on pages and API routes.
async function watchViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Refused to load (CSP): ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return violations;
}

test("the main flow runs under the CSP without violations and every response carries the headers", async ({ page }) => {
  const violations = await watchViolations(page);

  const start = await page.goto("/case-study");
  const headers = start?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("same-origin");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toContain("camera=()");
  for (const shot of ["requests", "review", "exported"]) await expect(page.locator(`img[src*="${shot}"]`).first()).toBeVisible();

  await page.goto("/impressum");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Impressum");
  await page.goto("/datenschutz");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Datenschutzerklärung");

  // A client address of its own: the other smoke specs sign in from 127.0.0.1 at the same time, and the
  // sign-in rate limit (per client address, AUTH_IP_HEADERS) would otherwise refuse the fourth attempt.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "203.0.113.77" });
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("sachbearbeitung@musterbau.example.com");
  await page.getByLabel("Passwort").fill(process.env.SEED_PASSWORD!);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByText("Rolle: Sachbearbeitung")).toBeVisible();

  await page.goto("/requests");
  await page.getByRole("link", { name: "Anfrage Rohrbogen und Flansche fuer Werk Ost", exact: true }).first().click();
  await expect(page.getByTestId("request-status")).toBeVisible();
  // Client-side navigation back (RSC fetch) and the interactive parts of the review page.
  await page.goBack();
  await expect(page.getByTestId("requests-table-wrap")).toBeVisible();

  const api = await page.request.get("/api/health");
  expect(api.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(api.headers()["x-content-type-options"]).toBe("nosniff");

  expect(violations).toEqual([]);
});
