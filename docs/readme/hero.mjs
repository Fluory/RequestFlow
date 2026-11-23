// Records the README hero (docs/readme/hero-light.webp, hero-dark.webp) from the three.js + GSAP scene in
// docs/readme/hero/, deterministically: the paused timeline is seeked to every frame, nothing runs in
// real time. three.js and GSAP are not dependencies of the app, so they come from a folder of their own:
//
//   npm install --prefix /tmp/readme-vendor --no-save three@0.187.0 gsap@3.15.1
//   README_VENDOR=/tmp/readme-vendor/node_modules node docs/readme/hero.mjs
//
// Needs the installed packages of this repository (Playwright, @fontsource) and Python 3 with Pillow.
// PW_CHROMIUM_PATH picks a pinned Chromium, as for the E2E smoke flows.
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const here = join(root, "docs/readme");
const vendor = process.env.README_VENDOR;
if (!vendor) {
  process.stderr.write("README_VENDOR is not set – see the header of docs/readme/hero.mjs\n");
  process.exit(1);
}
const FPS = 12;
const types = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2" };
const mounts = [
  ["/hero/", join(here, "hero")],
  ["/vendor/", vendor],
  ["/fonts/", join(root, "node_modules/@fontsource")],
];

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 600 }, deviceScaleFactor: 1 });
  await page.route("http://readme.local/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const mount = mounts.find(([prefix]) => path.startsWith(prefix));
    if (!mount) return route.fulfill({ status: 404 });
    const file = join(mount[1], path.slice(mount[0].length));
    return route.fulfill({ body: readFileSync(file), contentType: types[extname(file)] ?? "application/octet-stream" });
  });
  page.on("pageerror", (error) => process.stderr.write(`${error}\n`));
  await page.goto(`http://readme.local/hero/index.html?theme=${theme}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
  const duration = await page.evaluate(() => window.__duration);
  const frames = mkdtempSync(join(tmpdir(), "rf-hero-"));
  const count = Math.round(duration * FPS);
  for (let i = 0; i < count; i++) {
    await page.evaluate((t) => window.__seek(t), i / FPS);
    await page.locator("canvas").screenshot({ path: join(frames, `${String(i).padStart(4, "0")}.png`) });
  }
  const result = spawnSync("python3", [join(here, "webp.py"), frames, join(here, `hero-${theme}.webp`), String(FPS), "60"], { stdio: "inherit" });
  rmSync(frames, { recursive: true, force: true });
  if (result.status !== 0) throw new Error(`webp.py failed for ${theme}`);
  await page.close();
}
await browser.close();
