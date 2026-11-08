/**
 * Words for searching policy texts in Bangla and English. Only letters and
 * digits survive (Bangla block U+0980-U+09FF plus the joiners), so a word can
 * never carry search-syntax characters into the database query.
 */
const STOP_WORDS = [
  // English
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'many',
  'me',
  'much',
  'my',
  'of',
  'on',
  'or',
  'our',
  'the',
  'there',
  'this',
  'to',
  'we',
  'what',
  'when',
  'which',
  'who',
  'will',
  'with',
  'you',
  'your',
  'get',
  'have',
  'has',
  'about',
  'any',
  'company',
  'please',
  'tell',
  // Bangla
  'আমি',
  'আমার',
  'আমাদের',
  'কি',
  'কী',
  'কত',
  'কয়',
  'কোন',
  'কোনো',
  'কিভাবে',
  'কীভাবে',
  'এর',
  'ও',
  'এবং',
  'হয়',
  'হবে',
  'হলে',
  'জন্য',
  'থেকে',
  'করে',
  'করতে',
  'পারি',
  'পাবো',
  'পাব',
  'আছে',
  'কে',
  'যে',
  'সে',
  'এই',
  'একটি',
  'না',
  'নিয়ম',
  'কোম্পানির',
  'যায়',
  'পাওয়া',
];
const STOP = new Set(STOP_WORDS.map((w) => w.normalize('NFC')));

export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^a-z0-9ঀ-৿‌‍]+/)
    .map((w) => w.replace(/[‌‍]/g, ''))
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

/** Bangla digits to ASCII, lower case: for comparing answers with expected facts. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6))
    .toLowerCase()
    .normalize('NFC');
}

/** The sentences of a text (English full stops, the Bangla danda, line breaks). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.replace(/^[-*#\s]+/, '').trim())
    .filter((s) => s.length > 0);
}
