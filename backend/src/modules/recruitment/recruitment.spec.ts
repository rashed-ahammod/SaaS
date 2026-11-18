/**
 * Recruitment rules without a database (WP29). The important half of the WP29 acceptance
 * criterion lives here: "CV screening never sees name, gender, religion, age or photo".
 */
import { describe, expect, it } from 'vitest';
import {
  blindCv,
  canMove,
  parseScreening,
  screeningSystemPrompt,
} from './recruitment-rules.js';

/** A Bangladeshi CV as people actually write them: the person first, the work second. */
const CV = `Name: Md. Shahidul Islam
Father's Name: Abdul Karim
Date of Birth: 14-03-1997
Gender: Male
Religion: Islam
Marital Status: Married
Nationality: Bangladeshi
Blood Group: B+
Mobile: 01711-223344
Email: shahidul.islam@example.com
Present Address: House 12, Road 4, Mirpur, Dhaka
Photo: attached

CAREER OBJECTIVE
To work as an accounts professional. I am 29 years old and sincere.

EXPERIENCE
Accounts Officer, Padma Agro Ltd (2021 to date)
  - Accounts payable for 120 vendors; bills matched to purchase orders.
  - Monthly VAT return (Mushak 9.1) prepared and filed.
  - Daily entries in Tally ERP 9.

EDUCATION
B.Com (Accounting), National University, 2019

REFERENCES
Mr. Shahidul's former manager, Mrs. Fatema Begum, 01811-556677`;

const APPLICANT = {
  fullNameEn: 'Md. Shahidul Islam',
  fullNameBn: 'মোঃ শহিদুল ইসলাম',
  phone: '+8801711223344',
  email: 'shahidul.islam@example.com',
  dateOfBirth: '1997-03-14',
  gender: 'male',
  district: 'Dhaka',
};

describe('a CV is blind before any model sees it (spec §8 fairness)', () => {
  const blind = blindCv(CV, APPLICANT);
  const text = blind.text.toLowerCase();

  it('keeps nothing of the applicant’s name, anywhere in the text', () => {
    for (const part of ['shahidul', 'islam', 'md.', 'shahidul.islam'])
      expect(text).not.toContain(part);
  });

  it('removes gender, religion and marital status, as labels and as words', () => {
    for (const word of ['male', 'islam', 'muslim', 'married', 'mr.', 'mrs'])
      expect(text).not.toContain(word);
  });

  it('removes the date of birth and the age, in every form they appear', () => {
    expect(text).not.toContain('14-03-1997');
    expect(text).not.toContain('1997-03-14');
    expect(text).not.toContain('29 years');
  });

  it('removes the photo, the phone numbers and the e-mail', () => {
    expect(text).not.toContain('photo: attached');
    expect(text).not.toContain('01711');
    expect(text).not.toContain('01811');
    expect(text).not.toContain('@example.com');
  });

  it('removes the father’s and the referee’s names, which say as much as the applicant’s', () => {
    expect(text).not.toContain('abdul karim');
    expect(text).not.toContain('fatema');
  });

  it('keeps what the job is actually about', () => {
    for (const kept of [
      'accounts payable',
      'vat return',
      'tally erp 9',
      'b.com',
      'purchase orders',
    ])
      expect(text).toContain(kept);
  });

  it('says what it removed, so a fairness question can be answered', () => {
    expect(blind.removed).toContain('gender');
    expect(blind.removed).toContain('religion');
    expect(blind.removed).toEqual(
      expect.arrayContaining(['date of birth', 'photo']),
    );
  });

  it('works on a CV that has no labels at all', () => {
    const plain = blindCv(
      'Shahidul Islam, male, 29. Five years in accounts payable and VAT returns.',
      APPLICANT,
    );
    expect(plain.text.toLowerCase()).not.toContain('shahidul');
    expect(plain.text.toLowerCase()).not.toContain('male');
    expect(plain.text.toLowerCase()).toContain('accounts payable');
  });

  it('removes a Bangla CV’s protected labels too', () => {
    const bn = blindCv(
      [
        'নাম: মোঃ শহিদুল ইসলাম',
        'ধর্ম: ইসলাম',
        'বয়স: ২৯',
        'অভিজ্ঞতা: হিসাব সহকারী, ভ্যাট রিটার্ন দাখিল',
      ].join('\n'),
      APPLICANT,
    );
    expect(bn.text).not.toContain('শহিদুল');
    expect(bn.text).toContain('ভ্যাট রিটার্ন');
  });

  it('is told not to guess the removed things back', () => {
    const prompt = screeningSystemPrompt('en');
    expect(prompt).toContain('[removed]');
    expect(prompt.toLowerCase()).toContain('never guess');
    expect(prompt.toLowerCase()).toContain('you do not decide');
  });
});

describe('the application’s life', () => {
  it('goes applied -> screened -> shortlisted -> interviewing -> offered -> hired', () => {
    expect(canMove('applied', 'screened')).toBe(true);
    expect(canMove('screened', 'shortlisted')).toBe(true);
    expect(canMove('shortlisted', 'interviewing')).toBe(true);
    expect(canMove('interviewing', 'offered')).toBe(true);
    expect(canMove('offered', 'hired')).toBe(true);
  });

  it('never hires without an offer, and never goes backwards', () => {
    expect(canMove('applied', 'hired')).toBe(false);
    expect(canMove('interviewing', 'hired')).toBe(false);
    expect(canMove('shortlisted', 'applied')).toBe(false);
  });

  it('is final once hired, rejected or withdrawn', () => {
    for (const state of ['hired', 'rejected', 'withdrawn'] as const)
      for (const to of ['applied', 'screened', 'offered', 'hired'] as const)
        expect(canMove(state, to)).toBe(false);
  });
});

describe('a screening answer is only used when it is a score', () => {
  it('reads a score and its reasons', () => {
    const parsed = parseScreening(
      'Here you go: {"score": 82, "reasons": ["Filed VAT returns for three years."]}',
    );
    expect(parsed).toEqual({
      score: 82,
      reasons: ['Filed VAT returns for three years.'],
    });
  });

  it('keeps a score inside 0 to 100', () => {
    expect(parseScreening('{"score": 140, "reasons": []}')?.score).toBe(100);
    expect(parseScreening('{"score": -5, "reasons": []}')?.score).toBe(0);
  });

  it('is nothing when the model did not answer with a score', () => {
    expect(parseScreening('I think this candidate is excellent!')).toBeNull();
    expect(parseScreening('{"reasons": ["no score"]}')).toBeNull();
    expect(parseScreening('')).toBeNull();
  });
});
