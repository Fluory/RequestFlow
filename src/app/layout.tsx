import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getRuntime } from "./_server/runtime";
import { AppHeader } from "./_components/app-header";
import { DemoBanner } from "./_components/demo-banner";
import { SiteFooter } from "./_components/site-footer";
import { OPERATOR } from "./_components/operator";
// Self-hosted IBM Plex (Latin subset, only the weights the design uses) – no third-party requests.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./globals.css";
import "./components.css";
import "./review.css";
import "./case-study.css";

export const metadata: Metadata = {
  title: "RequestFlow",
  description: `Angebotsanfragen neben ihrer Quelle prüfen – Portfolio-Projekt von ${OPERATOR.name}: Referenzprojekt mit fiktivem Kunden, alle Daten synthetisch.`,
};

// Without a valid configuration (e.g. while `next build` prerenders) there is no banner; the pages
// themselves report the configuration error.
function demoMode(): boolean {
  try {
    return getRuntime().config.demoMode;
  } catch {
    return false;
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <DemoBanner enabled={demoMode()} />
        <AppHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
