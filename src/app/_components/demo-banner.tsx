// Showcase notice (DEMO_MODE=true, ADR-0001 D11): visible on every page, above the app header.
export function DemoBanner({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <div role="note" className="demo-banner">
      Demo – nur synthetische Daten
    </div>
  );
}
