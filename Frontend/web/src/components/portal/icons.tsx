/**
 * One small line icon per portal screen, so the menu can be scanned by shape
 * instead of read word by word. Plain inline SVG (no icon package): 24×24,
 * stroke only, so it takes the colour of the text around it.
 */
import type { IconName } from "@/lib/portal-guide";

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  people:
    "M3 20v-1.5A4.5 4.5 0 0 1 7.5 14h2A4.5 4.5 0 0 1 14 18.5V20M11 7.5A3 3 0 1 1 5 7.5a3 3 0 0 1 6 0M17 20v-1.5a4.5 4.5 0 0 0-2-3.7M16 5.2a3 3 0 0 1 0 5.6",
  person:
    "M5 20v-1.5A4.5 4.5 0 0 1 9.5 14h5a4.5 4.5 0 0 1 4.5 4.5V20M15 7.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  sitemap: "M9 4h6v4H9zM3 16h5v4H3zM16 16h5v4h-5zM12 8v4M5.5 16v-4h13v4",
  key: "M14.5 7.5a3.5 3.5 0 1 1-4.6 3.3L4 16.7V20h3.3l.9-.9v-1.8h1.8l1-1v-1.6l1.1-1.1a3.5 3.5 0 0 0 4.4-4.1M15.5 6.5h.01",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  calendar: "M4 7h16v13H4zM8 4v4M16 4v4M4 11h16",
  check: "M4 12.5 9 18l11-11",
  money: "M3 7h18v10H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 10v4M18 10v4",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  settings:
    "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M12 3v2M12 19v2M4.5 7.5l1.7 1M17.8 15.5l1.7 1M4.5 16.5l1.7-1M17.8 8.5l1.7-1",
  compare: "M12 4v16M7 8 3 13h8zM17 8l-4 5h8z",
  handshake: "M3 11l4-4 3 3 2-2 2 2 3-3 4 4-5 6-2-2-2 2-2-2-2 2z",
  chart: "M4 20V4M4 20h16M8 17v-5M13 17V8M18 17v-7",
  doc: "M6 3h7l5 5v13H6zM13 3v5h5M9 13h6M9 17h6",
  book: "M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2zM12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6",
  bank: "M3 9l9-5 9 5M5 9v10M19 9v10M3 20h18M9 19v-6M15 19v-6",
  cart: "M3 5h2l2.5 10h10L20 8H7M9 20h.01M17 20h.01",
  box: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  truck:
    "M3 7h11v9H3zM14 11h4l3 3v2h-7M6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M17.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  percent:
    "M6 18 18 6M8 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4M16 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  upload: "M12 16V4M8 8l4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  robot: "M6 9h12v9H6zM12 6V4M9 13h.01M15 13h.01M3 12v3M21 12v3",
  history: "M12 7v5l4 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4",
  plug: "M9 3v6M15 3v6M6 9h12v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6zM12 17v4",
  wallet:
    "M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7V5h12M16 13h.01",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2.5 2.5L16 10",
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3",
  tag: "M3 11V5a2 2 0 0 1 2-2h6l10 10-8 8z M8 8h.01",
};

export function Icon({
  name,
  className = "h-4 w-4",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
