import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getRuntime } from "./_server/runtime";
import { AppHeader } from "./_components/app-header";
import { DemoBanner } from "./_components/demo-banner";
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

export const metadata: Metadata = {
  title: "RequestFlow",
  description: "Quote requests, reviewed beside their source",
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
      </body>
    </html>
  );
}
