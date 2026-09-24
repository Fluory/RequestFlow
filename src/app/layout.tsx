import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppHeader } from "./_components/app-header";
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
