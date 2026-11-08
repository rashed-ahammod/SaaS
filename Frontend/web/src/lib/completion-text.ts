/**
 * Text for what was completed before go-live (2026-10-30): the PF fund (interest, withdrawal,
 * final settlement; keys "pf2.*") and resignation from the app ("rs.*"). Merged in i18n.tsx.
 */
export const en = {
  "pf2.kind.contribution": "Contribution",
  "pf2.kind.interest": "Interest",
  "pf2.kind.withdrawal": "Withdrawal",
  "pf2.kind.settlement": "Final settlement",
  "pf2.kind.forfeit": "Employer part not vested",
  "pf2.withdraw": "Withdrawal",
  "pf2.withdrawHint":
    "Paid from the member’s own part only; the voucher goes to the checker and counts once posted.",
  "pf2.settle": "Final settlement",
  "pf2.settleHint":
    "On leaving: the member’s own part, and the employer part as far as it has vested by years of service (placeholder: under 3 years 0%, 3 to 5 years 50%, 5 years and more 100%; verify against the PF trust deed). The rest returns to the company.",
  "pf2.years": "Years of service",
  "pf2.vested": "Employer part vested",
  "pf2.forfeited": "Forfeited",
  "pf2.payable": "Paid to the member",
  "pf2.paidFrom": "Paid from",
  "pf2.amount": "Amount",
  "pf2.date": "Date",
  "pf2.reason": "Purpose",
  "pf2.settled": "Settled",
  "pf2.notLeaving": "Only for an employee in notice or separated.",
  "pf2.interest": "PF interest for a year",
  "pf2.interestHint":
    "The rate the PF trustees declared, on each member’s balance on 30 June, to both parts. Once per year.",
  "pf2.fiscalYear": "Fiscal year",
  "pf2.rate": "Rate (%)",
  "pf2.credit": "Credit interest",
  "pf2.credited":
    "Interest {total} credited to {members} members (voucher {voucher}).",
  "rs.title": "Resignation",
  "appr.type.resignation": "Resignation",
  "rs.hint":
    "Your notice period is {days} days. Your Dept Head, then HR approve; then the clearance and final settlement start.",
  "rs.lastDay": "Last working day",
  "rs.reason": "Reason",
  "rs.submit": "Hand in my resignation",
  "rs.confirm": "Hand in your resignation? Your Dept Head and HR will be told.",
  "rs.short":
    "{days} day(s) short of the notice period: the shortfall may be deducted from the final settlement.",
  "rs.withdraw": "Withdraw my resignation",
  "rs.withdrawReason": "Why withdraw it?",
  "rs.state.in_approval": "Waiting for approval",
  "rs.state.accepted": "Accepted: you are in notice",
  "rs.state.rejected": "Not accepted",
  "rs.state.withdrawn": "Withdrawn",
} as const;

export const bn: Record<keyof typeof en, string> = {
  "pf2.kind.contribution": "চাঁদা",
  "pf2.kind.interest": "মুনাফা",
  "pf2.kind.withdrawal": "উত্তোলন",
  "pf2.kind.settlement": "চূড়ান্ত নিষ্পত্তি",
  "pf2.kind.forfeit": "অপ্রাপ্য নিয়োগকর্তার অংশ",
  "pf2.withdraw": "উত্তোলন",
  "pf2.withdrawHint":
    "শুধু সদস্যের নিজস্ব অংশ থেকে; ভাউচার যাচাইকারীর কাছে যায় এবং পোস্ট হলে গণনা হয়।",
  "pf2.settle": "চূড়ান্ত নিষ্পত্তি",
  "pf2.settleHint":
    "চলে যাওয়ার সময়: সদস্যের নিজস্ব অংশ, এবং চাকরির বছর অনুযায়ী প্রাপ্য নিয়োগকর্তার অংশ (অস্থায়ী মান: ৩ বছরের কম ০%, ৩–৫ বছর ৫০%, ৫ বছর বা বেশি ১০০%; পিএফ ট্রাস্ট ডিডের সাথে যাচাই করুন)। বাকিটা কোম্পানিতে ফেরত যায়।",
  "pf2.years": "চাকরির বছর",
  "pf2.vested": "প্রাপ্য নিয়োগকর্তার অংশ",
  "pf2.forfeited": "অপ্রাপ্য",
  "pf2.payable": "সদস্যকে প্রদেয়",
  "pf2.paidFrom": "যে হিসাব থেকে",
  "pf2.amount": "পরিমাণ",
  "pf2.date": "তারিখ",
  "pf2.reason": "উদ্দেশ্য",
  "pf2.settled": "নিষ্পত্তি হয়েছে",
  "pf2.notLeaving": "শুধু নোটিশে থাকা বা অব্যাহতিপ্রাপ্ত কর্মীর জন্য।",
  "pf2.interest": "বছরের পিএফ মুনাফা",
  "pf2.interestHint":
    "পিএফ ট্রাস্টিদের ঘোষিত হারে, ৩০ জুনের জের অনুযায়ী প্রত্যেক সদস্যের দুই অংশে। বছরে একবার।",
  "pf2.fiscalYear": "অর্থবছর",
  "pf2.rate": "হার (%)",
  "pf2.credit": "মুনাফা জমা করুন",
  "pf2.credited":
    "{members} জন সদস্যকে {total} মুনাফা জমা হয়েছে (ভাউচার {voucher})।",
  "rs.title": "পদত্যাগ",
  "appr.type.resignation": "পদত্যাগ",
  "rs.hint":
    "আপনার নোটিশ মেয়াদ {days} দিন। প্রথমে বিভাগীয় প্রধান, তারপর মানবসম্পদ অনুমোদন দেবেন; এরপর ছাড়পত্র ও চূড়ান্ত পাওনা শুরু হবে।",
  "rs.lastDay": "শেষ কর্মদিবস",
  "rs.reason": "কারণ",
  "rs.submit": "পদত্যাগপত্র জমা দিন",
  "rs.confirm":
    "পদত্যাগপত্র জমা দেবেন? আপনার বিভাগীয় প্রধান ও মানবসম্পদ বিভাগ জানবেন।",
  "rs.short":
    "নোটিশ মেয়াদের চেয়ে {days} দিন কম: ঘাটতি চূড়ান্ত পাওনা থেকে কাটা হতে পারে।",
  "rs.withdraw": "পদত্যাগপত্র প্রত্যাহার",
  "rs.withdrawReason": "কেন প্রত্যাহার করছেন?",
  "rs.state.in_approval": "অনুমোদনের অপেক্ষায়",
  "rs.state.accepted": "গৃহীত: আপনি নোটিশ মেয়াদে আছেন",
  "rs.state.rejected": "গৃহীত হয়নি",
  "rs.state.withdrawn": "প্রত্যাহার করা হয়েছে",
};
