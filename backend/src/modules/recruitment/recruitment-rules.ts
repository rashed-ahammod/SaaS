/**
 * Recruitment rules that are code, not settings (WP29), and the one that matters most:
 * making a CV blind before any model sees it.
 *
 *   blindCv(cvText, applicant)   removes who the person IS and leaves what they CAN DO
 *   canMove / NEXT               the application's life
 *   CONSENT_VERSION              which consent wording an applicant agreed to
 *
 * Pure functions, no database: recruitment.spec.ts tests them.
 */
import type { ApplicationState } from '../../platform/db/schema.js';

/**
 * The wording the applicant agrees to when their CV is kept (spec §11). Bump this when the
 * wording changes: applicants keep the version they actually agreed to.
 */
export const CONSENT_VERSION = 'cv-consent-v1';

/** How long an applicant who was not hired is kept. ILLUSTRATIVE (platform/retention.ts). */
export const APPLICANT_RETENTION_DAYS = 365;

export const SCREENING_PROMPT_VERSION = 'cv-screening-v1';

// ------------------------------------------------------------ the application

const NEXT: Record<ApplicationState, ApplicationState[]> = {
  applied: ['screened', 'shortlisted', 'rejected', 'withdrawn'],
  screened: ['shortlisted', 'rejected', 'withdrawn'],
  shortlisted: ['interviewing', 'offered', 'rejected', 'withdrawn'],
  interviewing: ['offered', 'rejected', 'withdrawn'],
  offered: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: [],
  withdrawn: [],
};

export function canMove(from: ApplicationState, to: ApplicationState): boolean {
  return NEXT[from].includes(to);
}

export const OPEN_APPLICATION_STATES: ApplicationState[] = [
  'applied',
  'screened',
  'shortlisted',
  'interviewing',
  'offered',
];

// --------------------------------------------------- blind CV (spec §8 fairness)

/**
 * Protected characteristics and contact details, in the words Bangladeshi CVs use for
 * them. A line whose label is one of these goes completely: "Father's Name: ..." tells the
 * model about family, religion and sometimes caste, and nothing about the work.
 */
const PROTECTED_LABELS = [
  'name',
  'full name',
  "father's name",
  'fathers name',
  'father name',
  "mother's name",
  'mothers name',
  'mother name',
  "husband's name",
  "wife's name",
  'spouse',
  'date of birth',
  'dob',
  'birth date',
  'age',
  'gender',
  'sex',
  'religion',
  'caste',
  'marital status',
  'marriage',
  'nationality',
  'photo',
  'photograph',
  'picture',
  'image',
  'nid',
  'national id',
  'national identity',
  'passport',
  'birth certificate',
  'blood group',
  'phone',
  'mobile',
  'cell',
  'contact',
  'contact no',
  'telephone',
  'email',
  'e-mail',
  'mail',
  'address',
  'present address',
  'permanent address',
  'village',
  'post office',
  'facebook',
  'linkedin',
  // Bangla
  'নাম',
  'পূর্ণ নাম',
  'পিতার নাম',
  'মাতার নাম',
  'স্বামীর নাম',
  'স্ত্রীর নাম',
  'জন্ম তারিখ',
  'জন্মতারিখ',
  'বয়স',
  'লিঙ্গ',
  'ধর্ম',
  'বৈবাহিক অবস্থা',
  'জাতীয়তা',
  'ছবি',
  'জাতীয় পরিচয়পত্র',
  'রক্তের গ্রুপ',
  'ফোন',
  'মোবাইল',
  'ইমেইল',
  'ই-মেইল',
  'ঠিকানা',
  'গ্রাম',
  'ডাকঘর',
];

/** Words that give away a protected characteristic even without a label. */
const PROTECTED_WORDS = [
  // gender
  'male',
  'female',
  'man',
  'woman',
  'he',
  'she',
  'his',
  'her',
  'mr',
  'mrs',
  'ms',
  'miss',
  'পুরুষ',
  'মহিলা',
  'নারী',
  'জনাব',
  'জনাবা',
  // religion
  'muslim',
  'islam',
  'hindu',
  'hinduism',
  'christian',
  'christianity',
  'buddhist',
  'buddhism',
  'catholic',
  'মুসলিম',
  'ইসলাম',
  'হিন্দু',
  'খ্রিষ্টান',
  'খ্রিস্টান',
  'বৌদ্ধ',
  // marital status
  'married',
  'unmarried',
  'single',
  'divorced',
  'widow',
  'widower',
  'বিবাহিত',
  'অবিবাহিত',
  'বিধবা',
];

const REMOVED = '[removed]';

export interface BlindCv {
  /** What the model is given: the CV with the person taken out of it. */
  text: string;
  /** What was taken out, for the record and for the fairness test. */
  removed: string[];
}

/**
 * Make a CV blind. Three passes, in this order:
 *   1. whole lines whose label is a protected characteristic or a contact detail;
 *   2. the applicant's own name, wherever it appears (headers, e-mail addresses, "I, Md. ...");
 *   3. words that give away gender, religion or marital status, and anything that looks
 *      like an age, a date of birth or a photo reference.
 *
 * It errs towards removing too much: a requirement mentioned in a removed line is a small
 * loss, while a name or a religion reaching the model is a fairness failure (spec §8).
 */
export function blindCv(
  cvText: string,
  applicant: {
    fullNameEn?: string | null;
    fullNameBn?: string | null;
    phone?: string | null;
    email?: string | null;
    dateOfBirth?: string | null;
    gender?: string | null;
    district?: string | null;
  } = {},
): BlindCv {
  const removed = new Set<string>();
  const lines = cvText.split(/\r?\n/);

  // 1. labelled lines
  const kept = lines.map((line) => {
    const label = /^\s*([^:：|\t]{1,40})\s*[:：|\t]/.exec(line)?.[1];
    if (label) {
      const plain = label.trim().toLowerCase().replace(/\s+/g, ' ');
      if (PROTECTED_LABELS.includes(plain)) {
        removed.add(plain);
        return `${label.trim()}: ${REMOVED}`;
      }
    }
    return line;
  });
  let text = kept.join('\n');

  // 2. the person's own identifiers
  //    A name is replaced whole and in parts ("Md. Shahidul Islam" also appears as
  //    "Shahidul"). An e-mail address is replaced whole and by the parts of its LOCAL part
  //    only: splitting the domain would also delete the word "com", which takes "B.Com"
  //    with it and loses a qualification.
  for (const name of [applicant.fullNameEn, applicant.fullNameBn]) {
    if (!name?.trim()) continue;
    if (replaceAll(name)) removed.add(name);
    for (const part of name.split(/[\s.,]+/))
      if (part.length >= 3 && /\p{L}/u.test(part) && replaceAll(part))
        removed.add(part);
  }
  if (applicant.email?.trim()) {
    if (replaceAll(applicant.email)) removed.add('email');
    for (const part of applicant.email.split('@')[0].split(/[\s.,+_-]+/))
      if (part.length >= 3 && /\p{L}/u.test(part) && replaceAll(part))
        removed.add(part);
  }
  if (applicant.dateOfBirth && replaceAll(applicant.dateOfBirth))
    removed.add('date of birth');
  if (applicant.phone && replaceAll(applicant.phone)) removed.add('phone');

  // 2b. other people's names a CV carries: the father, the referees. They say as much about
  //     family and religion as the applicant's own name, and the post needs none of them.
  const referees = /^[ \t]*(references?|referee[s]?|রেফারেন্স|প্রত্যয়নকারী)\b[\s\S]*$/im;
  if (referees.test(text)) {
    removed.add('references');
    text = text.replace(referees, `REFERENCES: ${REMOVED}`);
  }
  const honorific =
    /\b(mr|mrs|ms|miss|md|mohammad|mohammed|muhammad|janab)\.?\s+(\p{Lu}\p{L}+(\s+\p{Lu}\p{L}+){0,2})/gu;
  if (honorific.test(text)) {
    removed.add('other names');
    text = text.replace(honorific, REMOVED);
  }

  // 3. words and patterns
  for (const word of PROTECTED_WORDS) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escape(word)})(?=[^\\p{L}\\p{N}]|$)`, 'giu');
    if (re.test(text)) {
      removed.add(word);
      text = text.replace(re, `$1${REMOVED}`);
    }
  }
  // an age ("29 years old", "বয়স ২৯"), a date of birth, a photo
  const patterns: Array<[RegExp, string]> = [
    [/\b\d{1,2}\s*(years?|yrs?)\s*(old)?\b/gi, 'age'],
    [/\b(19|20)\d{2}[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/g, 'date'],
    [/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](19|20)\d{2}\b/g, 'date'],
    [/\b(photo|photograph|picture attached|image attached)\b/gi, 'photo'],
    [/[\w.+-]+@[\w-]+\.[\w.]+/g, 'email'],
    [/(?:\+?880[\s-]?|0)1[3-9]\d{1,2}[\s-]?\d{3,4}[\s-]?\d{3,4}/g, 'phone'],
  ];
  for (const [re, what] of patterns) {
    if (re.test(text)) {
      removed.add(what);
      text = text.replace(re, REMOVED);
    }
  }

  return { text: text.trim(), removed: [...removed] };

  function replaceAll(value: string): boolean {
    const re = new RegExp(escape(value), 'gi');
    if (!re.test(text)) return false;
    text = text.replace(re, REMOVED);
    return true;
  }
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * What the model may answer with. Anything else is treated as "no usable answer", so a
 * strange reply never becomes a score (the screening row is only written on success).
 */
export function parseScreening(answer: string): {
  score: number;
  reasons: string[];
} | null {
  const json = /\{[\s\S]*\}/.exec(answer)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { score?: unknown; reasons?: unknown };
    const score =
      typeof parsed.score === 'number' && Number.isFinite(parsed.score)
        ? Math.min(100, Math.max(0, Math.round(parsed.score)))
        : null;
    if (score === null) return null;
    const reasons = Array.isArray(parsed.reasons)
      ? parsed.reasons
          .filter((r): r is string => typeof r === 'string')
          .map((r) => r.slice(0, 300))
          .slice(0, 6)
      : [];
    return { score, reasons };
  } catch {
    return null;
  }
}

export function screeningSystemPrompt(language: 'bn' | 'en'): string {
  return [
    'You help an HR officer in Bangladesh sort job applications by how well the CV matches the requirements of one post.',
    'You are given the post, its requirements, and the text of ONE CV from which the applicant’s name, gender, religion, age, date of birth, marital status, photo and contact details have been removed and replaced with [removed].',
    'Judge ONLY evidence of ability to do this job: skills, education, years and kind of experience, certificates, languages, tools.',
    'Never guess, mention or ask about the applicant’s name, gender, religion, age, family, marital status, nationality, district or appearance. If a [removed] mark is near a requirement, treat that requirement as not evidenced rather than guessing.',
    'You do not decide anything: an HR officer reads your reasons and decides. Give a score out of 100 and short reasons that each point at a requirement.',
    'Answer with JSON only: {"score": <0-100>, "reasons": ["<short sentence>", ...]}.',
    `Write the reasons in ${language === 'bn' ? 'Bangla' : 'English'}.`,
  ].join('\n');
}
