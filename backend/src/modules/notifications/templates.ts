/**
 * Message texts, in Bangla and English (spec §8). Pure functions: the planner
 * collects the facts, these turn them into a subject, a body (e-mail / in-app)
 * and a short SMS text. SMS stays short: one Bangla SMS part holds 70 characters,
 * so the link carries the details.
 */
import { toBusinessDate } from '../../platform/dates/business-date.js';
import { formatAmount, toBanglaDigits } from '../../platform/money/format.js';
import { Money } from '../../platform/money/money.js';
import { monthName } from '../payroll/payslip-pdf.js';

export type Lang = 'bn' | 'en';

export interface Text {
  subject: string;
  body: string;
  sms: string;
}

const digits = (text: string, lang: Lang) =>
  lang === 'bn' ? toBanglaDigits(text) : text;
const taka = (amount: string, lang: Lang) =>
  `৳${formatAmount(Money.of(amount), lang)}`;

/** "2026-10-15" -> "15 Oct 2026" / "১৫ অক্টোবর ২০২৬" */
export function shortDate(date: string, lang: Lang): string {
  const [y, m, d] = date.split('-');
  const month = monthName(`${y}-${m}`, lang).split(' ')[0];
  return digits(
    `${Number(d)} ${lang === 'en' ? month.slice(0, 3) : month} ${y}`,
    lang,
  );
}

const DHAKA_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** A deadline: "15 Oct 2026, 16:30" / "১৫ অক্টোবর ২০২৬, ১৬:৩০" (Dhaka). */
export function shortDateTime(at: Date, lang: Lang): string {
  return `${shortDate(toBusinessDate(at), lang)}, ${digits(DHAKA_TIME.format(at), lang)}`;
}

export const TEMPLATES = {
  /** A new request in the approver's inbox. */
  approval_request: (lang: Lang, v: { summary: string; link: string }): Text =>
    lang === 'bn'
      ? {
          subject: `অনুমোদন প্রয়োজন: ${v.summary}`,
          body: `আপনার অনুমোদনের জন্য একটি অনুরোধ এসেছে:\n${v.summary}\n\nদেখুন ও সিদ্ধান্ত দিন: ${v.link}`,
          sms: `অনুমোদন প্রয়োজন। ${v.link}`,
        }
      : {
          subject: `Approval needed: ${v.summary}`,
          body: `A request is waiting for your approval:\n${v.summary}\n\nOpen and decide: ${v.link}`,
          sms: `Approval needed. ${v.link}`,
        },

  /** No decision after the reminder time (spec §5: 24 working hours). */
  approval_reminder: (
    lang: Lang,
    v: { summary: string; link: string },
  ): Text =>
    lang === 'bn'
      ? {
          subject: `স্মরণ: অনুমোদনের অপেক্ষায় — ${v.summary}`,
          body: `এই অনুরোধটি এখনো আপনার অনুমোদনের অপেক্ষায়:\n${v.summary}\n\nসময়মতো সিদ্ধান্ত না দিলে এটি আপনার ঊর্ধ্বতনের কাছে যাবে।\n${v.link}`,
          sms: `স্মরণ: একটি অনুরোধ আপনার অনুমোদনের অপেক্ষায়। ${v.link}`,
        }
      : {
          subject: `Reminder: waiting for your approval — ${v.summary}`,
          body: `This request is still waiting for your approval:\n${v.summary}\n\nWithout a decision it will go to your manager.\n${v.link}`,
          sms: `Reminder: a request is waiting for your approval. ${v.link}`,
        },

  /** Escalation: the request now (also) waits for this person (spec §5: 48 working hours). */
  approval_escalated: (
    lang: Lang,
    v: { summary: string; link: string },
  ): Text =>
    lang === 'bn'
      ? {
          subject: `আপনার কাছে পাঠানো হয়েছে: ${v.summary}`,
          body: `নির্ধারিত সময়ে সিদ্ধান্ত না হওয়ায় এই অনুরোধটি আপনার কাছে পাঠানো হয়েছে:\n${v.summary}\n\n${v.link}`,
          sms: `সময় পেরিয়ে যাওয়া একটি অনুরোধ আপনার কাছে এসেছে। ${v.link}`,
        }
      : {
          subject: `Escalated to you: ${v.summary}`,
          body: `No decision was made in time, so this request now waits for you:\n${v.summary}\n\n${v.link}`,
          sms: `An overdue request was escalated to you. ${v.link}`,
        },

  /** Tells the late approver that the request went up. */
  approval_passed_on: (
    lang: Lang,
    v: { summary: string; link: string },
  ): Text =>
    lang === 'bn'
      ? {
          subject: `ঊর্ধ্বতনের কাছে পাঠানো হয়েছে: ${v.summary}`,
          body: `নির্ধারিত সময়ে সিদ্ধান্ত না হওয়ায় এই অনুরোধটি আপনার ঊর্ধ্বতনের কাছেও পাঠানো হয়েছে। আপনি এখনো সিদ্ধান্ত দিতে পারেন:\n${v.summary}\n\n${v.link}`,
          sms: '',
        }
      : {
          subject: `Passed to your manager: ${v.summary}`,
          body: `No decision was made in time, so this request was also sent to your manager. You can still decide:\n${v.summary}\n\n${v.link}`,
          sms: '',
        },

  /** Salary paid (payroll.disbursed): the payslip PDF goes with the e-mail. */
  payslip_ready: (
    lang: Lang,
    v: {
      company: string;
      period: string;
      what: string | null;
      net: string;
      passwordHint: string;
      link: string;
    },
  ): Text => {
    const month = monthName(v.period, lang);
    const what = v.what ?? (lang === 'bn' ? 'বেতন' : 'salary');
    return lang === 'bn'
      ? {
          subject: `${v.company}: ${month} ${what} ${taka(v.net, lang)}`,
          body: `আপনার ${month} মাসের ${what} ${taka(v.net, lang)} পরিশোধ করা হয়েছে।\nবেতন বিবরণী (PDF) সংযুক্ত; পাসওয়ার্ড: আপনার ${v.passwordHint}।\nঅ্যাপে দেখুন: ${v.link}`,
          sms: `${v.company}: ${month} ${what} ${taka(v.net, lang)} পরিশোধ হয়েছে। ${v.link}`,
        }
      : {
          subject: `${v.company}: ${what} for ${month}, ${taka(v.net, lang)}`,
          body: `Your ${what} for ${month}, ${taka(v.net, lang)}, has been paid.\nThe payslip (PDF) is attached; password: your ${v.passwordHint}.\nIn the app: ${v.link}`,
          sms: `${v.company}: ${what} for ${month} ${taka(v.net, lang)} paid. ${v.link}`,
        };
  },

  /** Morning list for a Dept Head (attendance.daily_closed). */
  attendance_digest: (
    lang: Lang,
    v: {
      date: string;
      department: string;
      headcount: number;
      lines: Array<{
        name: string;
        code: string;
        status: string;
        lateMinutes: number;
      }>;
      link: string;
    },
  ): Text => {
    const label: Record<string, Record<Lang, string>> = {
      absent: { en: 'Absent', bn: 'অনুপস্থিত' },
      late: { en: 'Late', bn: 'দেরি' },
      half_day: { en: 'Half day', bn: 'অর্ধদিবস' },
      missing_punch: { en: 'Missing punch', bn: 'পাঞ্চ বাকি' },
    };
    const count = (s: string) => v.lines.filter((l) => l.status === s).length;
    const date = shortDate(v.date, lang);
    const rows = v.lines.map(
      (l) =>
        `• ${l.name} (${l.code}) — ${label[l.status]?.[lang] ?? l.status}${l.status === 'late' ? digits(` ${l.lateMinutes} ${lang === 'bn' ? 'মি' : 'min'}`, lang) : ''}`,
    );
    if (lang === 'bn') {
      return {
        subject: `হাজিরা ${date}, ${v.department}: অনুপস্থিত ${digits(String(count('absent')), lang)}, দেরি ${digits(String(count('late')), lang)}`,
        body: `${v.department} — ${date}, মোট ${digits(String(v.headcount), lang)} জন\n\n${rows.length ? rows.join('\n') : 'সবাই সময়মতো উপস্থিত ছিলেন।'}\n\nবিস্তারিত: ${v.link}`,
        sms: '',
      };
    }
    return {
      subject: `Attendance ${date}, ${v.department}: ${count('absent')} absent, ${count('late')} late`,
      body: `${v.department} — ${date}, ${v.headcount} people\n\n${rows.length ? rows.join('\n') : 'Everyone was present on time.'}\n\nDetails: ${v.link}`,
      sms: '',
    };
  },

  /** The employee's leave was decided. */
  leave_decision: (
    lang: Lang,
    v: { approved: boolean; from: string; to: string; link: string },
  ): Text => {
    const range =
      v.from === v.to
        ? shortDate(v.from, lang)
        : `${shortDate(v.from, lang)} – ${shortDate(v.to, lang)}`;
    return lang === 'bn'
      ? {
          subject: `আপনার ছুটি (${range}) ${v.approved ? 'অনুমোদিত হয়েছে' : 'অনুমোদিত হয়নি'}`,
          body: `আপনার ${range} তারিখের ছুটির আবেদন ${v.approved ? 'অনুমোদিত হয়েছে।' : 'অনুমোদিত হয়নি।'}\n${v.link}`,
          sms: '',
        }
      : {
          subject: `Your leave (${range}) was ${v.approved ? 'approved' : 'not approved'}`,
          body: `Your leave request for ${range} was ${v.approved ? 'approved' : 'not approved'}.\n${v.link}`,
          sms: '',
        };
  },

  /** Probation ends soon: the Dept Head recommends confirm, extend or end (spec §6.1). */
  probation_review: (
    lang: Lang,
    v: { name: string; code: string; endDate: string; link: string },
  ): Text => {
    const date = shortDate(v.endDate, lang);
    return lang === 'bn'
      ? {
          subject: `শিক্ষানবিশকাল শেষ হচ্ছে: ${v.name} (${v.code}), ${date}`,
          body: `${v.name}-এর (${v.code}) শিক্ষানবিশকাল ${date} তারিখে শেষ হবে। স্থায়ী করা, মেয়াদ বাড়ানো বা চাকরি শেষ করার সুপারিশ দিন:
${v.link}`,
          sms: '',
        }
      : {
          subject: `Probation ends ${date}: ${v.name} (${v.code})`,
          body: `The probation of ${v.name} (${v.code}) ends on ${date}. Please recommend: confirm, extend or end.
${v.link}`,
          sms: '',
        };
  },

  /** A budget line reached the warning percent (80) or 100 % (spec §6.6). */
  budget_alert: (
    lang: Lang,
    v: {
      department: string;
      account: string | null;
      percent: string;
      used: string;
      budget: string;
      level: number;
      link: string;
    },
  ): Text => {
    const what =
      v.account ?? (lang === 'bn' ? 'মোট বাজেট' : 'the whole budget');
    const pct = digits(v.percent, lang);
    return lang === 'bn'
      ? {
          subject: `${v.level >= 100 ? 'বাজেট শেষ' : 'বাজেট সতর্কতা'}: ${v.department}, ${what} ${pct}%`,
          body: `${v.department} বিভাগের ${what} খাতে বাজেটের ${pct}% ব্যবহৃত বা প্রতিশ্রুত (${taka(v.used, lang)} / ${taka(v.budget, lang)})।${v.level >= 100 ? ' এর বেশি খরচে অ্যাডমিনের অনুমোদন লাগবে।' : ''}\n${v.link}`,
          sms: '',
        }
      : {
          subject: `${v.level >= 100 ? 'Budget used up' : 'Budget warning'}: ${v.department}, ${what} at ${pct}%`,
          body: `${v.department} has used or committed ${pct}% of the budget for ${what} (${taka(v.used, lang)} of ${taka(v.budget, lang)}).${v.level >= 100 ? ' Spending beyond it needs the Admin.' : ''}\n${v.link}`,
          sms: '',
        };
  },

  /** A return or deposit of the compliance calendar is due in 7 days or tomorrow (WP21). */
  compliance_due: (
    lang: Lang,
    v: { title: string; dueDate: string; daysLeft: number; link: string },
  ): Text => {
    const date = shortDate(v.dueDate, lang);
    const days = digits(String(v.daysLeft), lang);
    return lang === 'bn'
      ? {
          subject: `সময়সীমা ${date}: ${v.title}`,
          body: `${v.title}: শেষ তারিখ ${date} (${days} দিন বাকি)। সময়মতো দাখিল / জমা দিন, তারপর ক্যালেন্ডারে সম্পন্ন চিহ্নিত করুন।\n${v.link}`,
          sms: '',
        }
      : {
          subject: `Due ${date}: ${v.title}`,
          body: `${v.title} is due on ${date} (${days} day${v.daysLeft === 1 ? '' : 's'} left). File or deposit it in time; then it is marked done in the calendar.\n${v.link}`,
          sms: '',
        };
  },

  /** The due date has passed and it is still open. */
  compliance_overdue: (
    lang: Lang,
    v: { title: string; dueDate: string; daysLeft: number; link: string },
  ): Text => {
    const date = shortDate(v.dueDate, lang);
    return lang === 'bn'
      ? {
          subject: `সময়সীমা পেরিয়েছে: ${v.title}`,
          body: `${v.title}: শেষ তারিখ ছিল ${date}, এখনো সম্পন্ন হয়নি। জরিমানা এড়াতে দ্রুত দাখিল / জমা দিন।\n${v.link}`,
          sms: `সময়সীমা পেরিয়েছে (${date}): ${v.title}`,
        }
      : {
          subject: `Overdue: ${v.title}`,
          body: `${v.title} was due on ${date} and is still open. File or deposit it now to limit penalties.\n${v.link}`,
          sms: `Overdue since ${date}: ${v.title}`,
        };
  },

  /** An invoice long past due (WP27): the account manager follows it up. */
  invoice_overdue: (
    lang: Lang,
    v: {
      invoiceNo: string;
      customer: string;
      outstanding: string;
      daysLate: number;
      link: string;
    },
  ): Text => {
    const days = digits(String(v.daysLate), lang);
    return lang === 'bn'
      ? {
          subject: `বকেয়া আদায়: ${v.customer}, ${v.invoiceNo}`,
          body: `${v.customer}-এর চালান ${v.invoiceNo}: ${taka(v.outstanding, lang)} বকেয়া, ${days} দিন দেরি। গ্রাহকের সাথে যোগাযোগ করে আদায় করুন।\n${v.link}`,
          sms: '',
        }
      : {
          subject: `Collect: ${v.customer}, ${v.invoiceNo}`,
          body: `${v.customer}'s invoice ${v.invoiceNo}: ${taka(v.outstanding, lang)} still owed, ${days} days late. Please follow it up with the customer.\n${v.link}`,
          sms: '',
        };
  },

  /** A lead for the salesperson (WP23): contact them quickly. */
  lead_assigned: (
    lang: Lang,
    v: {
      number: string;
      who: string;
      district: string | null;
      source: string;
      link: string;
    },
  ): Text => {
    const where = v.district ? ` (${v.district})` : '';
    return lang === 'bn'
      ? {
          subject: `নতুন লিড ${v.number}: ${v.who}`,
          body: `আপনার জন্য নতুন লিড: ${v.who}${where}, উৎস: ${v.source}। দ্রুত যোগাযোগ করুন।\n${v.link}`,
          sms: '',
        }
      : {
          subject: `New lead ${v.number}: ${v.who}`,
          body: `A new lead for you: ${v.who}${where}, from ${v.source}. Please contact them soon.\n${v.link}`,
          sms: '',
        };
  },

  /** A document that runs out (WP31): HR replaces it before it does. */
  document_expiring: (
    lang: Lang,
    v: {
      who: string;
      docType: string;
      expiresOn: string;
      stage: 'days_30' | 'days_7' | 'expired';
      link: string;
    },
  ): Text => {
    const date = shortDate(v.expiresOn, lang);
    const expired = v.stage === 'expired';
    return lang === 'bn'
      ? {
          subject: expired
            ? `কাগজের মেয়াদ শেষ: ${v.who}`
            : `কাগজের মেয়াদ শেষ হচ্ছে: ${v.who}`,
          body: `${v.who}-এর ${v.docType} কাগজটির মেয়াদ ${date}${expired ? ' তারিখে শেষ হয়েছে' : ' তারিখে শেষ হবে'}। নতুন কাগজ নিয়ে আপলোড করুন।\n${v.link}`,
          sms: expired ? `কাগজের মেয়াদ শেষ: ${v.who}, ${date}` : '',
        }
      : {
          subject: expired
            ? `Document expired: ${v.who}`
            : `Document expiring: ${v.who}`,
          body: `${v.who}'s ${v.docType} ${expired ? 'expired on' : 'expires on'} ${date}. Please collect and upload the new one.\n${v.link}`,
          sms: expired ? `Document expired: ${v.who}, ${date}` : '',
        };
  },

  /** A ticket for the person who must answer it (WP28). */
  ticket_assigned: (
    lang: Lang,
    v: {
      number: string;
      customer: string;
      subject: string;
      priority: string;
      dueIn: string;
      link: string;
    },
  ): Text =>
    lang === 'bn'
      ? {
          subject: `নতুন অভিযোগ ${v.number}: ${v.customer}`,
          body: `${v.customer}-এর অভিযোগ (${v.priority}): ${v.subject}। প্রথম উত্তর দিতে হবে ${v.dueIn}-এর মধ্যে।
${v.link}`,
          sms: '',
        }
      : {
          subject: `Ticket ${v.number}: ${v.customer}`,
          body: `A ticket from ${v.customer} (${v.priority}): ${v.subject}. First response due by ${v.dueIn}.
${v.link}`,
          sms: '',
        },

  /** The SLA clock ran out (WP28): the same weight as an escalated approval. */
  ticket_sla_breached: (
    lang: Lang,
    v: {
      number: string;
      customer: string;
      subject: string;
      clock: 'first_response' | 'resolution';
      link: string;
    },
  ): Text => {
    const what =
      v.clock === 'first_response'
        ? { bn: 'প্রথম উত্তরের', en: 'first response' }
        : { bn: 'সমাধানের', en: 'resolution' };
    return lang === 'bn'
      ? {
          subject: `এসএলএ পেরিয়েছে: অভিযোগ ${v.number}`,
          body: `${v.customer}-এর অভিযোগ ${v.number} (${v.subject}): ${what.bn} সময় পেরিয়ে গেছে। এখনই দেখুন।
${v.link}`,
          sms: `এসএলএ পেরিয়েছে: অভিযোগ ${v.number}, ${v.customer}`,
        }
      : {
          subject: `SLA missed: ticket ${v.number}`,
          body: `${v.customer}'s ticket ${v.number} (${v.subject}) is past its ${what.en} deadline. Please act now.
${v.link}`,
          sms: `SLA missed: ticket ${v.number}, ${v.customer}`,
        };
  },
};

export type Kind = keyof typeof TEMPLATES;

/** Which channels each kind uses (SMS only where it is worth the cost; never the only channel). */
export const CHANNELS: Record<Kind, Array<'in_app' | 'email' | 'sms'>> = {
  approval_request: ['in_app', 'email'],
  approval_reminder: ['in_app', 'email', 'sms'],
  approval_escalated: ['in_app', 'email', 'sms'],
  approval_passed_on: ['in_app', 'email'],
  payslip_ready: ['in_app', 'email', 'sms'],
  attendance_digest: ['in_app', 'email'],
  leave_decision: ['in_app'],
  probation_review: ['in_app', 'email'],
  budget_alert: ['in_app', 'email'],
  compliance_due: ['in_app', 'email'],
  compliance_overdue: ['in_app', 'email', 'sms'],
  lead_assigned: ['in_app', 'email'],
  invoice_overdue: ['in_app', 'email'],
  document_expiring: ['in_app', 'email'],
  ticket_assigned: ['in_app', 'email'],
  ticket_sla_breached: ['in_app', 'email', 'sms'],
};
