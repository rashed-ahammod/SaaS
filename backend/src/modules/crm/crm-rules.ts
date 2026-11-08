/**
 * CRM rules that need no database (Phase 3 WP23).
 *
 *   normalizePhone(text)   a Bangladesh number as +880..., or null: "01711-223344",
 *                          "+88 01711 223344", "8801711223344" -> "+8801711223344";
 *                          a Dhaka land line "02-9881234" -> "+88029881234"
 *   normalizeEmail(text)   trimmed and lower-cased, or null when it is not an e-mail
 *   districtOf(text)       the district as written in the list (any case, Bangla or English
 *                          names of the 64 districts), or null
 *   nextInTurn(users, last)   round robin: the user after the last one given a lead
 *   monthEnd / monthsBetween  "YYYY-MM" months for the forecast and targets (WP24)
 */

/** The 64 districts of Bangladesh: English name (as stored) and Bangla name. */
export const DISTRICTS: Array<[string, string]> = [
  ['Bagerhat', 'বাগেরহাট'],
  ['Bandarban', 'বান্দরবান'],
  ['Barguna', 'বরগুনা'],
  ['Barishal', 'বরিশাল'],
  ['Bhola', 'ভোলা'],
  ['Bogura', 'বগুড়া'],
  ['Brahmanbaria', 'ব্রাহ্মণবাড়িয়া'],
  ['Chandpur', 'চাঁদপুর'],
  ['Chapainawabganj', 'চাঁপাইনবাবগঞ্জ'],
  ['Chattogram', 'চট্টগ্রাম'],
  ['Chuadanga', 'চুয়াডাঙ্গা'],
  ["Cox's Bazar", 'কক্সবাজার'],
  ['Cumilla', 'কুমিল্লা'],
  ['Dhaka', 'ঢাকা'],
  ['Dinajpur', 'দিনাজপুর'],
  ['Faridpur', 'ফরিদপুর'],
  ['Feni', 'ফেনী'],
  ['Gaibandha', 'গাইবান্ধা'],
  ['Gazipur', 'গাজীপুর'],
  ['Gopalganj', 'গোপালগঞ্জ'],
  ['Habiganj', 'হবিগঞ্জ'],
  ['Jamalpur', 'জামালপুর'],
  ['Jashore', 'যশোর'],
  ['Jhalokathi', 'ঝালকাঠি'],
  ['Jhenaidah', 'ঝিনাইদহ'],
  ['Joypurhat', 'জয়পুরহাট'],
  ['Khagrachhari', 'খাগড়াছড়ি'],
  ['Khulna', 'খুলনা'],
  ['Kishoreganj', 'কিশোরগঞ্জ'],
  ['Kurigram', 'কুড়িগ্রাম'],
  ['Kushtia', 'কুষ্টিয়া'],
  ['Lakshmipur', 'লক্ষ্মীপুর'],
  ['Lalmonirhat', 'লালমনিরহাট'],
  ['Madaripur', 'মাদারীপুর'],
  ['Magura', 'মাগুরা'],
  ['Manikganj', 'মানিকগঞ্জ'],
  ['Meherpur', 'মেহেরপুর'],
  ['Moulvibazar', 'মৌলভীবাজার'],
  ['Munshiganj', 'মুন্সিগঞ্জ'],
  ['Mymensingh', 'ময়মনসিংহ'],
  ['Naogaon', 'নওগাঁ'],
  ['Narail', 'নড়াইল'],
  ['Narayanganj', 'নারায়ণগঞ্জ'],
  ['Narsingdi', 'নরসিংদী'],
  ['Natore', 'নাটোর'],
  ['Netrokona', 'নেত্রকোনা'],
  ['Nilphamari', 'নীলফামারী'],
  ['Noakhali', 'নোয়াখালী'],
  ['Pabna', 'পাবনা'],
  ['Panchagarh', 'পঞ্চগড়'],
  ['Patuakhali', 'পটুয়াখালী'],
  ['Pirojpur', 'পিরোজপুর'],
  ['Rajbari', 'রাজবাড়ী'],
  ['Rajshahi', 'রাজশাহী'],
  ['Rangamati', 'রাঙ্গামাটি'],
  ['Rangpur', 'রংপুর'],
  ['Satkhira', 'সাতক্ষীরা'],
  ['Shariatpur', 'শরীয়তপুর'],
  ['Sherpur', 'শেরপুর'],
  ['Sirajganj', 'সিরাজগঞ্জ'],
  ['Sunamganj', 'সুনামগঞ্জ'],
  ['Sylhet', 'সিলেট'],
  ['Tangail', 'টাঙ্গাইল'],
  ['Thakurgaon', 'ঠাকুরগাঁও'],
];

/** Older spellings people still type. */
const ALIASES: Record<string, string> = {
  chittagong: 'Chattogram',
  comilla: 'Cumilla',
  barisal: 'Barishal',
  bogra: 'Bogura',
  jessore: 'Jashore',
  'coxs bazar': "Cox's Bazar",
  'cox bazar': "Cox's Bazar",
};

export function districtOf(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const key = t.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ');
  const hit = DISTRICTS.find(
    ([en, bn]) => en.toLowerCase().replace(/'/g, '') === key || bn === t,
  );
  return hit?.[0] ?? (ALIASES[key] ? ALIASES[key] : null);
}

export function normalizePhone(text: string | null | undefined): string | null {
  if (!text) return null;
  // Bangla digits to ASCII; drop spaces, dashes, brackets, dots
  let d = text
    .replace(/[০-৯]/g, (c) => String(c.charCodeAt(0) - 0x09e6))
    .replace(/[\s\-().]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('00')) d = d.slice(2);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith('880')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  // mobile: 1[3-9] + 8 digits; land line: area code + number (8 to 10 digits in all)
  if (/^1[3-9]\d{8}$/.test(d)) return `+880${d}`;
  if (/^[2-9]\d{7,9}$/.test(d)) return `+880${d}`;
  return null;
}

export function normalizeEmail(text: string | null | undefined): string | null {
  const t = (text ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) ? t : null;
}

/** Round robin: the user after `last` in a fixed order (or the first). */
export function nextInTurn(
  users: string[],
  last: string | null | undefined,
): string | null {
  if (!users.length) return null;
  const sorted = [...users].sort();
  const i = last ? sorted.indexOf(last) : -1;
  return sorted[(i + 1) % sorted.length];
}

/** "2026-11" -> "2026-11-30": the last day of a month. */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(days).padStart(2, '0')}`;
}

/** The months from one to another, both included: ("2026-11", "2027-01") -> 2026-11, 2026-12, 2027-01. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
