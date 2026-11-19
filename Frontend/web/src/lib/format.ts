/**
 * Showing numbers, money, dates and times the Bangladeshi way (guide §19):
 * lakh/crore grouping (12,34,567.00), Bangla digits in Bangla, Asia/Dhaka time.
 * Money arrives from the API as decimal strings and is only formatted, never
 * calculated with, in the app.
 */
export type Lang = "bn" | "en";

const BANGLA_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
const MONTHS: Record<Lang, string[]> = {
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  bn: [
    "জানুয়ারি",
    "ফেব্রুয়ারি",
    "মার্চ",
    "এপ্রিল",
    "মে",
    "জুন",
    "জুলাই",
    "আগস্ট",
    "সেপ্টেম্বর",
    "অক্টোবর",
    "নভেম্বর",
    "ডিসেম্বর",
  ],
};
const WEEKDAYS: Record<Lang, string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  bn: ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"],
};

export function toBanglaDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => BANGLA_DIGITS[Number(d)]);
}

/** Digits in the user's language. */
export function num(value: number | string, lang: Lang): string {
  const text = String(value);
  return lang === "bn" ? toBanglaDigits(text) : text;
}

/** "1234567.5" -> "12,34,567.50" (lakh grouping), Bangla digits in Bangla. */
export function formatAmount(amount: string | number, lang: Lang): string {
  const [whole, fraction = "00"] = (
    typeof amount === "number" ? amount.toFixed(2) : amount
  ).split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}`
    : lastThree;
  const text = `${negative ? "-" : ""}${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
  return num(text, lang);
}

/** "৳ 29,000.00" */
export function formatTaka(amount: string | number, lang: Lang): string {
  return `৳ ${formatAmount(amount, lang)}`;
}

/** "2026-10-15" -> "15 October 2026" / "১৫ অক্টোবর ২০২৬" */
export function formatDate(
  date: string,
  lang: Lang,
  o: { weekday?: boolean; short?: boolean } = {},
): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const month = MONTHS[lang][m - 1];
  const text = `${d} ${o.short && lang === "en" ? month.slice(0, 3) : month}${o.short ? "" : ` ${y}`}`;
  const day = o.weekday ? `${WEEKDAYS[lang][weekdayIndex(date)]}, ` : "";
  return num(day + text, lang);
}

/** "2026-09" -> "September 2026" */
export function formatMonth(period: string, lang: Lang): string {
  const [y, m] = period.split("-").map(Number);
  return num(`${MONTHS[lang][m - 1]} ${y}`, lang);
}

export function weekdayName(date: string, lang: Lang): string {
  return WEEKDAYS[lang][weekdayIndex(date)];
}

function weekdayIndex(date: string): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** An instant (ISO) as Dhaka clock time, "09:05". */
export function formatTime(
  instant: string | null | undefined,
  lang: Lang,
): string {
  if (!instant) return "–";
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(instant));
  return num(text, lang);
}

/** 537 -> "8h 57m" / "৮ ঘ ৫৭ মি" */
export function formatMinutes(minutes: number, lang: Lang): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return lang === "bn" ? num(`${h} ঘ ${m} মি`, lang) : `${h}h ${m}m`;
}

/**
 * Now, as the app should believe it.
 *
 * Normally the machine's clock. In development the demo is one story told on one
 * day, and the API is pinned to that day (DEV_CLOCK): the app has to agree with
 * it, or the two disagree about what "today" means — a claim dated today is
 * refused as being in the future, a month the API has not reached yet looks
 * empty. NEXT_PUBLIC_DEV_CLOCK is inlined at build time and is never set in
 * production.
 */
export function dhakaNow(): Date {
  const pinned = process.env.NEXT_PUBLIC_DEV_CLOCK;
  if (!pinned || !onOwnMachine()) return new Date();
  const at = new Date(pinned);
  return Number.isNaN(at.getTime()) ? new Date() : at;
}

/**
 * Whether this page is being served from the developer's own machine.
 *
 * The demo clock is a development setting, and the backend refuses to start with
 * it in production. The app cannot refuse to start, and a wrong "today" is the
 * kind of fault nobody reports and everybody works around, so it is ignored
 * anywhere but localhost — a setting left behind in a hosting dashboard cannot
 * freeze the date for real users. NODE_ENV cannot stand in for this: the e2e
 * suite runs a production build on localhost, and needs the clock honoured.
 */
function onOwnMachine(): boolean {
  if (typeof window === 'undefined') return process.env.NODE_ENV !== 'production';
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

/** Today's date in Dhaka as YYYY-MM-DD. */
export function dhakaToday(now: Date = dhakaNow()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** First and last day of a month "2026-10". */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${period}-01`,
    to: `${period}-${String(last).padStart(2, "0")}`,
  };
}

/** "2026-10" plus n months. */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Leave days "1.5" -> "1.5", Bangla digits in Bangla. */
export function formatDays(days: number, lang: Lang): string {
  return num(Number.isInteger(days) ? String(days) : days.toFixed(1), lang);
}
