---
paths:
  - "e2e/**"
  - "tests/e2e/**"
  - "**/*.e2e.*"
  - "playwright.config.*"
  - "src/**/*.{tsx,jsx,vue,svelte}"
---

# E2E and UI rules (loaded when UI components or browser tests are read)

- Browser tests are outer-loop proof: run only the affected spec or the defined smoke flows, targeted before the PR or in CI – never after every edit.
- Locators by role, label or test id (`getByRole`, `getByLabel`, `getByTestId`); no CSS classes, no XPath, no copy text that changes with wording.
- Recurring flows (login, navigation, form submit) live in page objects or component objects; a spec reads like the user story.
- A failing E2E run links trace or screenshot in the PR; reproduce the one failing flow first instead of starting new broad runs.
- UI changes from P1: keyboard operation, understandable labels, loading/empty/error states checked (review checklist); styling and layout get a proof of check, not an artificial test.
