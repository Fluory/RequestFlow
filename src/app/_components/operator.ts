// Operator of the public showcase, for Impressum and Datenschutz (#legal pages). Same identity as the
// operator's portfolio site (FinalPortfolioWebsite `src/content/site.ts`, `site.legal`) – change both together.
// Empty fields are left out of the pages, never shown as a placeholder.
export const OPERATOR = {
  name: "Florian Hein",
  street: "Goethestraße 60",
  city: "74343 Sachsenheim",
  country: "Deutschland",
  email: "hein.florian.dev@gmail.com",
  phone: "",
  /** Kleinunternehmer nach § 19 UStG – otherwise set vatId. */
  smallBusiness: true,
  vatId: "",
  updated: "November 2026",
} as const;

export const operatorAddress = (): string[] => [OPERATOR.name, OPERATOR.street, OPERATOR.city, OPERATOR.country].filter(Boolean);
