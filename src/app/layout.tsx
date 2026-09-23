import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppHeader } from "./_components/app-header";
import "./globals.css";

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
