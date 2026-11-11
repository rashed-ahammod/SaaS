"use client";
/**
 * Bangla and English text for the app (spec §8: Bangla and English from day one).
 *
 *   const { t, lang, setLang } = useI18n();
 *   t('leave.apply')                       -> "Apply for leave" / "ছুটির আবেদন"
 *   t('home.hello', { name: 'Rafi' })      -> "Hello, Rafi"
 *
 * The choice is kept on the phone (localStorage) and sent to the API as
 * X-Language, so error messages from the server come in the same language.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en as ATTENDANCE_EN, bn as ATTENDANCE_BN } from "./attendance-text";
import { en as EXPENSE_EN, bn as EXPENSE_BN } from "./expense-text";
import { en as LEAVE_EN, bn as LEAVE_BN } from "./leave-text";
import { en as PAYROLL_EN, bn as PAYROLL_BN } from "./payroll-text";
import { en as LIFECYCLE_EN, bn as LIFECYCLE_BN } from "./lifecycle-text";
import { en as PROCUREMENT_EN, bn as PROCUREMENT_BN } from "./procurement-text";
import { en as BUDGET_EN, bn as BUDGET_BN } from "./budget-text";
import { en as ASSET_EN, bn as ASSET_BN } from "./asset-text";
import { en as BANK_EN, bn as BANK_BN } from "./bank-text";
import { en as VAT_EN, bn as VAT_BN } from "./vat-text";
import { en as CLOSE_EN, bn as CLOSE_BN } from "./close-text";
import { en as CRM_EN, bn as CRM_BN } from "./crm-text";
import { en as SALES_EN, bn as SALES_BN } from "./sales-text";
import { en as ACCESS_EN, bn as ACCESS_BN } from "./access-text";
import { en as COMPLETION_EN, bn as COMPLETION_BN } from "./completion-text";
import { en as ENQUIRY_EN, bn as ENQUIRY_BN } from "./enquiry-text";
import { PORTAL_TEXT } from "./portal-text";
import type { Lang } from "./format";

const en = {
  "app.name": "My Office",
  "app.offline":
    "You are offline. Showing what was loaded; actions need the internet.",
  "common.loading": "Loading…",
  "common.retry": "Try again",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.back": "Back",
  "common.submit": "Submit",
  "common.yes": "Yes",
  "common.no": "No",
  "common.none": "Nothing here yet.",
  "common.days": "{n} day(s)",
  "common.reason": "Reason",
  "common.saved": "Saved.",
  "common.error": "Something went wrong. Please try again.",
  "nav.home": "Home",
  "nav.attendance": "Attendance",
  "nav.leave": "Leave",
  "nav.payslips": "Payslips",
  "nav.approvals": "Approvals",
  "nav.profile": "Me",
  "login.title": "Sign in",
  "login.workspace": "Company code",
  "login.workspaceHint": "Given by HR, e.g. demo",
  "login.login": "E-mail or mobile number",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.code": "6-digit code from your authenticator app",
  "login.verify": "Verify",
  "login.mfaTitle": "Two-step verification",
  "login.rememberDevice": "Remember this device for 30 days",
  "login.rememberDeviceHint":
    "On this device only the password will be asked next time. High-risk actions still ask for a code. Do not tick this on a shared computer.",
  "home.hello": "Hello, {name}",
  "home.today": "Today",
  "home.punchNow": "Punch in / out",
  "home.balances": "Leave balance",
  "home.lastPayslip": "Latest payslip",
  "home.approvalsWaiting": "{n} request(s) waiting for your approval",
  "home.noEmployee":
    "Your login is not linked to an employee record. Please contact HR.",
  "status.present": "Present",
  "status.late": "Late",
  "status.half_day": "Half day",
  "status.absent": "Absent",
  "status.on_leave": "On leave",
  "status.holiday": "Holiday",
  "status.weekend": "Weekend",
  "status.missing_punch": "Missing punch",
  "status.notYet": "No punch yet",
  "att.title": "Attendance",
  "att.in": "In",
  "att.out": "Out",
  "att.late": "Late {m} min",
  "att.punch": "Punch now",
  "att.punchOffice": "Punch from office computer",
  "att.punched": "Punched at {time}.",
  "att.locating": "Finding your location…",
  "att.locationDenied":
    "Location is needed to punch from the phone. Allow location for this site and try again.",
  "att.registerPhone": "Register this phone",
  "att.phoneName": "Phone name, e.g. Samsung A15",
  "att.phonePending":
    "This phone is waiting for HR approval. You can punch once HR approves it.",
  "att.phoneRevoked": "This phone was revoked by HR.",
  "att.phoneNotRegistered":
    "To punch with this phone, register it once. HR approves it.",
  "att.month": "Month",
  "att.summary": "Present {p} · Late {l} · Absent {a} · Leave {lv}",
  "leave.title": "Leave",
  "leave.balances": "Balances",
  "leave.available": "{n} available",
  "leave.pending": "{n} pending",
  "leave.apply": "Apply for leave",
  "leave.myRequests": "My requests",
  "leave.type": "Leave type",
  "leave.from": "From",
  "leave.to": "To",
  "leave.halfDay": "Half day",
  "leave.fullDay": "Full day",
  "leave.firstHalf": "First half",
  "leave.secondHalf": "Second half",
  "leave.reason": "Reason (optional)",
  "leave.check": "Check days",
  "leave.preview": "{n} day(s) will be counted.",
  "leave.previewAvailable": "Balance before: {n} day(s).",
  "leave.teamWarning":
    "{date}: {count} of {total} in your team would be on leave.",
  "leave.applied": "Your leave request was sent for approval.",
  "leave.cancel": "Cancel request",
  "leave.cancelReason": "Why do you cancel it?",
  "leave.cancelled": "Request cancelled.",
  "leave.state.pending": "Waiting",
  "leave.state.approved": "Approved",
  "leave.state.rejected": "Rejected",
  "leave.state.returned": "Returned",
  "leave.state.cancelled": "Cancelled",
  "leave.document": "Supporting document",
  "leave.documentHint":
    "Doctor's certificate or other proof (photo or PDF), needed for more than {n} day(s).",
  "leave.documentAdd": "Photo / PDF",
  "leave.documentAdded": "Document attached.",
  "leave.uploading": "Uploading…",
  "leave.resendTitle": "Change and send again",
  "leave.resend": "Send again",
  "leave.editResend": "Change and send again",
  "leave.approverSaid": "Approver: “{c}”",
  "pay.title": "Payslips",
  "pay.net": "Net pay",
  "pay.gross": "Total earnings",
  "pay.deductions": "Deductions",
  "pay.earnings": "Earnings",
  "pay.employer": "Paid by the employer",
  "pay.download": "Download PDF",
  "pay.downloadBn": "বাংলা PDF",
  "pay.downloadEn": "English PDF",
  "pay.protect": "Protect the PDF with a password",
  "pay.passwordHint": "Password: your {hint}.",
  "pay.hint.date of birth as DDMMYYYY": "date of birth as DDMMYYYY",
  "pay.hint.employee code": "employee code",
  "pay.type.regular": "Salary",
  "pay.type.bonus": "Festival bonus",
  "pay.type.final_settlement": "Final settlement",
  "appr.title": "Approvals",
  "appr.empty": "Nothing is waiting for you.",
  "appr.step": "Step {n}",
  "appr.submitted": "Submitted {date}",
  "appr.escalates": "Escalates {date}",
  "appr.onBehalf": "On behalf of a colleague",
  "appr.approve": "Approve",
  "appr.reject": "Reject",
  "appr.return": "Return for correction",
  "appr.comment": "Comment",
  "appr.commentRequired": "A comment is needed to reject or return.",
  "appr.done": "Done.",
  "appr.details": "Details",
  "appr.history": "History",
  // who decides, and who decides after them: the chain was always sent and never shown
  "appr.chain": "Who approves this",
  "appr.chainStep": "Step {n}: {who}",
  "appr.waitingOn": "Waiting for {who}",
  "appr.youAreHere": "This step is yours",
  "appr.because.line_manager": "as the line manager",
  "appr.because.dept_head": "as the department head",
  "appr.because.role": "by role",
  "appr.because.user": "named on the chain",
  "appr.overdue": "Past its time",
  "appr.requestedBy": "Asked by",
  "appr.onBehalfOfName": "for {name}",
  "appr.approverState.pending": "Waiting",
  "appr.approverState.approved": "Approved",
  "appr.approverState.rejected": "Rejected",
  "appr.approverState.returned": "Returned",
  "appr.approverState.skipped": "Not needed",
  "appr.approverState.cancelled": "Withdrawn",
  // the history, as sentences rather than verbs from the database
  "appr.act.submit": "Sent for approval",
  "appr.act.approve": "Approved",
  "appr.act.reject": "Rejected",
  "appr.act.return": "Returned for correction",
  "appr.act.cancel": "Withdrawn",
  "appr.act.remind": "Reminder sent",
  "appr.act.escalate": "Escalated",
  "appr.act.execute": "Carried out",
  // what is being approved, in words: the snapshot's field names
  "appr.f.date": "Date",
  "appr.f.inTime": "In",
  "appr.f.outTime": "Out",
  "appr.f.reason": "Reason",
  "appr.f.minutes": "Minutes",
  "appr.f.leaveType": "Leave type",
  "appr.f.from": "From",
  "appr.f.to": "To",
  "appr.f.halfDay": "Half day",
  "appr.f.days": "Days",
  "appr.f.availableBefore": "Balance before this leave",
  "appr.f.teamWarnings": "Team already away",
  "appr.f.number": "Number",
  "appr.f.purpose": "Purpose",
  "appr.f.amount": "Amount",
  "appr.f.total": "Total",
  "appr.f.neededBy": "Needed by",
  "appr.f.title": "Title",
  "appr.f.lines": "Items",
  "appr.f.advance": "Advance",
  "appr.f.note": "Note",
  "appr.f.narration": "Narration",
  "appr.f.bankName": "Bank",
  "appr.f.routingNumber": "Routing number",
  "appr.f.vendorName": "Vendor",
  "appr.f.department": "Department",
  "appr.f.customer": "Customer",
  "appr.f.state": "State",
  "appr.f.status": "Status",
  "appr.f.period": "Period",
  "appr.f.store": "Store",
  "appr.f.vendor": "Vendor",
  "appr.f.budget": "Budget",
  "appr.f.fiscalYear": "Financial year",
  "appr.type.leave_request": "Leave",
  "appr.type.attendance_correction": "Attendance correction",
  "appr.type.overtime_request": "Overtime",
  "appr.type.overtime": "Overtime",
  "appr.type.bank_account_change": "Salary account change",
  "appr.type.salary_advance": "Salary advance",
  "appr.type.payroll_run": "Payroll",
  "appr.type.disbursement_file_cancel": "Cancel bank file",
  "appr.type.voucher": "Voucher",
  "appr.type.vendor_bill": "Vendor bill",
  "appr.type.vendor_bank_account": "Vendor bank account",
  "appr.type.expense_claim": "Expense claim",
  "appr.type.expense_advance": "Cash advance",
  "notif.title": "Notifications",
  "notif.empty": "No messages yet.",
  "notif.readAll": "Mark all read",
  "notif.unread": "Unread",
  "notif.open": "Notifications ({n} unread)",
  "me.title": "My profile",
  "me.code": "Employee code",
  "me.joined": "Joined",
  "me.contact": "Contact details",
  "me.phone": "Mobile",
  "me.email": "Personal e-mail",
  "me.address": "Present address",
  "me.emergencyName": "Emergency contact name",
  "me.emergencyPhone": "Emergency contact mobile",
  "me.language": "Language",
  "me.signOut": "Sign out",
  "me.mfa": "Two-step verification",
  "me.mfaScan":
    "Your role needs two-step verification. Open an authenticator app (Google Authenticator, Microsoft Authenticator, Bitwarden…), scan this picture, then enter the 6-digit code it shows.",
  "me.mfaKey": "Cannot scan? Type this key into the app instead:",
  "me.mfaStart": "Set up two-step verification",
  "me.mfaDone": "Two-step verification is on.",
  "me.install":
    'Tip: use "Add to Home screen" in your browser menu to open this like an app.',
  "ai.title": "Ask the assistant",
  "ai.cardHint":
    "Questions about leave, attendance, pay or company rules, in Bangla or English.",
  "ai.intro":
    "I can answer from the company handbook and show your own leave balance, attendance and payslips. I cannot apply for leave or change anything.",
  "ai.example1": "How many casual leave days do I have left?",
  "ai.example2": "When is salary paid?",
  "ai.example3": "What happens if I come late three times?",
  "ai.placeholder": "Type your question",
  "ai.send": "Ask",
  "ai.thinking": "Looking it up…",
  "ai.sources": "From",
  "ai.helpful": "Helpful",
  "ai.notHelpful": "Not helpful",
  "ai.thanks": "Thank you for the feedback.",
  "ai.disclaimer":
    "Answers are generated by AI and can be wrong. Check important details with HR.",
  "ai.unavailable":
    "The assistant is not available right now. All other screens work as usual.",
  "consent.title": "Consents",
  "consent.biometric_attendance": "Fingerprint / face attendance device",
  "consent.location_attendance": "Phone location for punching",
  "consent.selfie_attendance": "Photo when punching",
  "consent.granted": "You agreed",
  "consent.withdrawn": "Withdrawn",
  "consent.none": "Not answered",
  "consent.agree": "I agree",
  "consent.withdraw": "Withdraw",
  "consent.readNotice": "Read the notice",
  "consent.locationNeeded":
    "To punch from this phone, the app sends your location once at each punch. Please read and agree first.",
} as const;

export type MessageKey = keyof typeof en;

const bn: Record<MessageKey, string> = {
  "app.name": "আমার অফিস",
  "app.offline":
    "আপনি অফলাইনে আছেন। আগে লোড হওয়া তথ্য দেখানো হচ্ছে; কাজ করতে ইন্টারনেট লাগবে।",
  "common.loading": "লোড হচ্ছে…",
  "common.retry": "আবার চেষ্টা করুন",
  "common.save": "সংরক্ষণ",
  "common.cancel": "বাতিল",
  "common.close": "বন্ধ",
  "common.back": "পেছনে",
  "common.submit": "জমা দিন",
  "common.yes": "হ্যাঁ",
  "common.no": "না",
  "common.none": "এখনো কিছু নেই।",
  "common.days": "{n} দিন",
  "common.reason": "কারণ",
  "common.saved": "সংরক্ষিত হয়েছে।",
  "common.error": "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।",
  "nav.home": "হোম",
  "nav.attendance": "হাজিরা",
  "nav.leave": "ছুটি",
  "nav.payslips": "বেতন",
  "nav.approvals": "অনুমোদন",
  "nav.profile": "আমি",
  "login.title": "সাইন ইন",
  "login.workspace": "কোম্পানি কোড",
  "login.workspaceHint": "মানবসম্পদ বিভাগ দেবে, যেমন demo",
  "login.login": "ই-মেইল বা মোবাইল নম্বর",
  "login.password": "পাসওয়ার্ড",
  "login.submit": "সাইন ইন",
  "login.code": "অথেনটিকেটর অ্যাপের ৬ অঙ্কের কোড",
  "login.verify": "যাচাই করুন",
  "login.mfaTitle": "দুই ধাপের যাচাই",
  "login.rememberDevice": "এই ডিভাইসটি ৩০ দিন মনে রাখুন",
  "login.rememberDeviceHint":
    "এই ডিভাইসে পরেরবার শুধু পাসওয়ার্ড লাগবে। ঝুঁকিপূর্ণ কাজে তখনও কোড চাওয়া হবে। অন্যের বা সবার ব্যবহারের কম্পিউটারে এটি টিক দেবেন না।",
  "home.hello": "আসসালামু আলাইকুম, {name}",
  "home.today": "আজ",
  "home.punchNow": "পাঞ্চ ইন / আউট",
  "home.balances": "ছুটির ব্যালান্স",
  "home.lastPayslip": "সর্বশেষ বেতন বিবরণী",
  "home.approvalsWaiting": "{n}টি অনুরোধ আপনার অনুমোদনের অপেক্ষায়",
  "home.noEmployee":
    "আপনার লগইন কোনো কর্মীর সাথে যুক্ত নয়। মানবসম্পদ বিভাগে যোগাযোগ করুন।",
  "status.present": "উপস্থিত",
  "status.late": "দেরি",
  "status.half_day": "অর্ধদিবস",
  "status.absent": "অনুপস্থিত",
  "status.on_leave": "ছুটিতে",
  "status.holiday": "ছুটির দিন",
  "status.weekend": "সাপ্তাহিক ছুটি",
  "status.missing_punch": "পাঞ্চ বাকি",
  "status.notYet": "এখনো পাঞ্চ হয়নি",
  "att.title": "হাজিরা",
  "att.in": "প্রবেশ",
  "att.out": "প্রস্থান",
  "att.late": "{m} মিনিট দেরি",
  "att.punch": "এখন পাঞ্চ করুন",
  "att.punchOffice": "অফিসের কম্পিউটার থেকে পাঞ্চ",
  "att.punched": "{time}-এ পাঞ্চ হয়েছে।",
  "att.locating": "আপনার অবস্থান খোঁজা হচ্ছে…",
  "att.locationDenied":
    "ফোন থেকে পাঞ্চ করতে অবস্থান (লোকেশন) লাগবে। এই সাইটের জন্য লোকেশন চালু করে আবার চেষ্টা করুন।",
  "att.registerPhone": "এই ফোন নিবন্ধন করুন",
  "att.phoneName": "ফোনের নাম, যেমন Samsung A15",
  "att.phonePending":
    "এই ফোনটি মানবসম্পদ বিভাগের অনুমোদনের অপেক্ষায়। অনুমোদনের পর পাঞ্চ করতে পারবেন।",
  "att.phoneRevoked": "মানবসম্পদ বিভাগ এই ফোনটি বাতিল করেছে।",
  "att.phoneNotRegistered":
    "এই ফোন দিয়ে পাঞ্চ করতে একবার নিবন্ধন করুন। মানবসম্পদ বিভাগ অনুমোদন দেবে।",
  "att.month": "মাস",
  "att.summary": "উপস্থিত {p} · দেরি {l} · অনুপস্থিত {a} · ছুটি {lv}",
  "leave.title": "ছুটি",
  "leave.balances": "ব্যালান্স",
  "leave.available": "{n} দিন বাকি",
  "leave.pending": "{n} দিন অপেক্ষমাণ",
  "leave.apply": "ছুটির আবেদন",
  "leave.myRequests": "আমার আবেদন",
  "leave.type": "ছুটির ধরন",
  "leave.from": "শুরু",
  "leave.to": "শেষ",
  "leave.halfDay": "অর্ধদিবস",
  "leave.fullDay": "পূর্ণদিবস",
  "leave.firstHalf": "প্রথমার্ধ",
  "leave.secondHalf": "দ্বিতীয়ার্ধ",
  "leave.reason": "কারণ (ঐচ্ছিক)",
  "leave.check": "দিন হিসাব দেখুন",
  "leave.preview": "{n} দিন গণনা হবে।",
  "leave.previewAvailable": "আগের ব্যালান্স: {n} দিন।",
  "leave.teamWarning":
    "{date}: আপনার দলের {total} জনের মধ্যে {count} জন ছুটিতে থাকবেন।",
  "leave.applied": "আপনার ছুটির আবেদন অনুমোদনের জন্য পাঠানো হয়েছে।",
  "leave.cancel": "আবেদন বাতিল",
  "leave.cancelReason": "কেন বাতিল করছেন?",
  "leave.cancelled": "আবেদন বাতিল হয়েছে।",
  "leave.state.pending": "অপেক্ষমাণ",
  "leave.state.approved": "অনুমোদিত",
  "leave.state.rejected": "প্রত্যাখ্যাত",
  "leave.state.returned": "ফেরত",
  "leave.state.cancelled": "বাতিল",
  "leave.document": "সহায়ক নথি",
  "leave.documentHint":
    "ডাক্তারের সনদ বা অন্য প্রমাণ (ছবি বা পিডিএফ), {n} দিনের বেশি হলে লাগবে।",
  "leave.documentAdd": "ছবি / পিডিএফ",
  "leave.documentAdded": "নথি যুক্ত হয়েছে।",
  "leave.uploading": "আপলোড হচ্ছে…",
  "leave.resendTitle": "পরিবর্তন করে আবার পাঠান",
  "leave.resend": "আবার পাঠান",
  "leave.editResend": "পরিবর্তন করে আবার পাঠান",
  "leave.approverSaid": "অনুমোদনকারী: “{c}”",
  "pay.title": "বেতন বিবরণী",
  "pay.net": "নিট বেতন",
  "pay.gross": "মোট আয়",
  "pay.deductions": "কর্তন",
  "pay.earnings": "আয়",
  "pay.employer": "নিয়োগকর্তার প্রদেয়",
  "pay.download": "PDF ডাউনলোড",
  "pay.downloadBn": "বাংলা PDF",
  "pay.downloadEn": "English PDF",
  "pay.protect": "পাসওয়ার্ড দিয়ে PDF সুরক্ষিত করুন",
  "pay.passwordHint": "পাসওয়ার্ড: আপনার {hint}।",
  "pay.hint.date of birth as DDMMYYYY": "জন্মতারিখ (DDMMYYYY)",
  "pay.hint.employee code": "কর্মী কোড",
  "pay.type.regular": "বেতন",
  "pay.type.bonus": "উৎসব ভাতা",
  "pay.type.final_settlement": "চূড়ান্ত নিষ্পত্তি",
  "appr.title": "অনুমোদন",
  "appr.empty": "আপনার জন্য কিছু অপেক্ষায় নেই।",
  "appr.step": "ধাপ {n}",
  "appr.submitted": "জমা: {date}",
  "appr.escalates": "এসকেলেশন: {date}",
  "appr.onBehalf": "সহকর্মীর পক্ষে",
  "appr.approve": "অনুমোদন",
  "appr.reject": "প্রত্যাখ্যান",
  "appr.return": "সংশোধনের জন্য ফেরত",
  "appr.comment": "মন্তব্য",
  "appr.commentRequired": "প্রত্যাখ্যান বা ফেরত দিতে মন্তব্য লাগবে।",
  "appr.done": "সম্পন্ন।",
  "appr.details": "বিস্তারিত",
  "appr.history": "ইতিহাস",
  "appr.chain": "কারা অনুমোদন করবেন",
  "appr.chainStep": "ধাপ {n}: {who}",
  "appr.waitingOn": "{who}-এর অপেক্ষায়",
  "appr.youAreHere": "এই ধাপ আপনার",
  "appr.because.line_manager": "সরাসরি ব্যবস্থাপক হিসেবে",
  "appr.because.dept_head": "বিভাগীয় প্রধান হিসেবে",
  "appr.because.role": "ভূমিকা অনুযায়ী",
  "appr.because.user": "চেইনে নাম থাকায়",
  "appr.overdue": "সময় পেরিয়ে গেছে",
  "appr.requestedBy": "আবেদন করেছেন",
  "appr.onBehalfOfName": "{name}-এর পক্ষে",
  "appr.approverState.pending": "অপেক্ষায়",
  "appr.approverState.approved": "অনুমোদিত",
  "appr.approverState.rejected": "প্রত্যাখ্যাত",
  "appr.approverState.returned": "ফেরত",
  "appr.approverState.skipped": "প্রয়োজন হয়নি",
  "appr.approverState.cancelled": "প্রত্যাহার",
  "appr.act.submit": "অনুমোদনের জন্য পাঠানো হয়েছে",
  "appr.act.approve": "অনুমোদন করা হয়েছে",
  "appr.act.reject": "প্রত্যাখ্যান করা হয়েছে",
  "appr.act.return": "সংশোধনের জন্য ফেরত",
  "appr.act.cancel": "প্রত্যাহার করা হয়েছে",
  "appr.act.remind": "স্মারক পাঠানো হয়েছে",
  "appr.act.escalate": "এসকেলেট করা হয়েছে",
  "appr.act.execute": "কার্যকর হয়েছে",
  "appr.f.date": "তারিখ",
  "appr.f.inTime": "প্রবেশ",
  "appr.f.outTime": "প্রস্থান",
  "appr.f.reason": "কারণ",
  "appr.f.minutes": "মিনিট",
  "appr.f.leaveType": "ছুটির ধরন",
  "appr.f.from": "শুরু",
  "appr.f.to": "শেষ",
  "appr.f.halfDay": "অর্ধদিবস",
  "appr.f.days": "দিন",
  "appr.f.availableBefore": "এই ছুটির আগে জমা",
  "appr.f.teamWarnings": "দলের যারা আগেই ছুটিতে",
  "appr.f.number": "নম্বর",
  "appr.f.purpose": "উদ্দেশ্য",
  "appr.f.amount": "পরিমাণ",
  "appr.f.total": "মোট",
  "appr.f.neededBy": "যে তারিখের মধ্যে দরকার",
  "appr.f.title": "শিরোনাম",
  "appr.f.lines": "খাতসমূহ",
  "appr.f.advance": "অগ্রিম",
  "appr.f.note": "মন্তব্য",
  "appr.f.narration": "বিবরণ",
  "appr.f.bankName": "ব্যাংক",
  "appr.f.routingNumber": "রাউটিং নম্বর",
  "appr.f.vendorName": "সরবরাহকারী",
  "appr.f.department": "বিভাগ",
  "appr.f.customer": "ক্রেতা",
  "appr.f.state": "অবস্থা",
  "appr.f.status": "অবস্থা",
  "appr.f.period": "সময়কাল",
  "appr.f.store": "স্টোর",
  "appr.f.vendor": "সরবরাহকারী",
  "appr.f.budget": "বাজেট",
  "appr.f.fiscalYear": "অর্থবছর",
  "appr.type.leave_request": "ছুটি",
  "appr.type.attendance_correction": "হাজিরা সংশোধন",
  "appr.type.overtime_request": "ওভারটাইম",
  "appr.type.overtime": "ওভারটাইম",
  "appr.type.bank_account_change": "বেতন হিসাব পরিবর্তন",
  "appr.type.salary_advance": "অগ্রিম বেতন",
  "appr.type.payroll_run": "বেতন প্রক্রিয়া",
  "appr.type.disbursement_file_cancel": "ব্যাংক ফাইল বাতিল",
  "appr.type.voucher": "ভাউচার",
  "appr.type.vendor_bill": "সরবরাহকারীর বিল",
  "appr.type.vendor_bank_account": "সরবরাহকারীর ব্যাংক হিসাব",
  "appr.type.expense_claim": "খরচের দাবি",
  "appr.type.expense_advance": "নগদ অগ্রিম",
  "notif.title": "বার্তা",
  "notif.empty": "এখনো কোনো বার্তা নেই।",
  "notif.readAll": "সব পড়া হয়েছে",
  "notif.unread": "পড়া হয়নি",
  "notif.open": "বার্তা ({n}টি পড়া হয়নি)",
  "me.title": "আমার প্রোফাইল",
  "me.code": "কর্মী কোড",
  "me.joined": "যোগদান",
  "me.contact": "যোগাযোগের তথ্য",
  "me.phone": "মোবাইল",
  "me.email": "ব্যক্তিগত ই-মেইল",
  "me.address": "বর্তমান ঠিকানা",
  "me.emergencyName": "জরুরি যোগাযোগের নাম",
  "me.emergencyPhone": "জরুরি যোগাযোগের মোবাইল",
  "me.language": "ভাষা",
  "me.signOut": "সাইন আউট",
  "me.mfa": "দুই ধাপের যাচাই",
  "me.mfaScan":
    "আপনার দায়িত্বে দুই ধাপের যাচাই বাধ্যতামূলক। ফোনে একটি অথেনটিকেটর অ্যাপ (Google Authenticator, Microsoft Authenticator, Bitwarden…) খুলে এই ছবিটি স্ক্যান করুন, তারপর অ্যাপে দেখানো ৬ অঙ্কের কোড দিন।",
  "me.mfaKey": "স্ক্যান করা যাচ্ছে না? অ্যাপে এই কী-টি হাতে লিখুন:",
  "me.mfaStart": "দুই ধাপের যাচাই চালু করুন",
  "me.mfaDone": "দুই ধাপের যাচাই চালু আছে।",
  "me.install":
    'পরামর্শ: ব্রাউজারের মেনু থেকে "Add to Home screen" দিলে এটি অ্যাপের মতো খুলবে।',
  "ai.title": "সহকারীকে জিজ্ঞেস করুন",
  "ai.cardHint":
    "ছুটি, হাজিরা, বেতন বা অফিসের নিয়ম নিয়ে প্রশ্ন, বাংলায় বা ইংরেজিতে।",
  "ai.intro":
    "আমি কোম্পানির হ্যান্ডবুক থেকে উত্তর দিতে পারি এবং আপনার নিজের ছুটির হিসাব, হাজিরা ও বেতন বিবরণী দেখাতে পারি। ছুটির আবেদন বা কোনো তথ্য পরিবর্তন করতে পারি না।",
  "ai.example1": "আমার নৈমিত্তিক ছুটি কত দিন বাকি আছে?",
  "ai.example2": "বেতন কবে দেওয়া হয়?",
  "ai.example3": "এক মাসে তিনবার দেরিতে এলে কী হয়?",
  "ai.placeholder": "আপনার প্রশ্ন লিখুন",
  "ai.send": "জিজ্ঞেস করুন",
  "ai.thinking": "খুঁজে দেখছি…",
  "ai.sources": "সূত্র",
  "ai.helpful": "কাজে লেগেছে",
  "ai.notHelpful": "কাজে লাগেনি",
  "ai.thanks": "মতামতের জন্য ধন্যবাদ।",
  "ai.disclaimer":
    "উত্তরগুলো এআই তৈরি করে এবং ভুল হতে পারে। গুরুত্বপূর্ণ বিষয় HR-এর সাথে মিলিয়ে নিন।",
  "ai.unavailable": "সহকারী এখন চালু নেই। অন্য সব স্ক্রিন আগের মতোই কাজ করবে।",
  "consent.title": "সম্মতি",
  "consent.biometric_attendance": "আঙুলের ছাপ / মুখ শনাক্তকরণ হাজিরা মেশিন",
  "consent.location_attendance": "পাঞ্চের জন্য ফোনের অবস্থান",
  "consent.selfie_attendance": "পাঞ্চের সময় ছবি",
  "consent.granted": "আপনি সম্মতি দিয়েছেন",
  "consent.withdrawn": "প্রত্যাহার করা হয়েছে",
  "consent.none": "উত্তর দেওয়া হয়নি",
  "consent.agree": "আমি সম্মত",
  "consent.withdraw": "প্রত্যাহার করুন",
  "consent.readNotice": "নোটিশ পড়ুন",
  "consent.locationNeeded":
    "এই ফোন থেকে পাঞ্চ করতে প্রতিবার পাঞ্চের সময় অ্যাপ একবার আপনার অবস্থান পাঠায়। আগে পড়ে সম্মতি দিন।",
};

// the HR / Admin portal's text (src/lib/portal-text), keys "p.*"; expense claims (expense-text.ts), keys "x.*"
const DICT: Record<Lang, Record<string, string>> = {
  en: {
    ...en,
    ...PORTAL_TEXT.en,
    ...EXPENSE_EN,
    ...ATTENDANCE_EN,
    ...LEAVE_EN,
    ...PAYROLL_EN,
    ...LIFECYCLE_EN,
    ...PROCUREMENT_EN,
    ...BUDGET_EN,
    ...ASSET_EN,
    ...BANK_EN,
    ...VAT_EN,
    ...CLOSE_EN,
    ...CRM_EN,
    ...SALES_EN,
    ...ACCESS_EN,
    ...COMPLETION_EN,
    ...ENQUIRY_EN,
  },
  bn: {
    ...bn,
    ...PORTAL_TEXT.bn,
    ...EXPENSE_BN,
    ...ATTENDANCE_BN,
    ...LEAVE_BN,
    ...PAYROLL_BN,
    ...LIFECYCLE_BN,
    ...PROCUREMENT_BN,
    ...BUDGET_BN,
    ...ASSET_BN,
    ...BANK_BN,
    ...VAT_BN,
    ...CLOSE_BN,
    ...CRM_BN,
    ...SALES_BN,
    ...ACCESS_BN,
    ...COMPLETION_BN,
    ...ENQUIRY_BN,
  },
};

/** Pure lookup (also used in tests). Unknown keys fall back to English, then to the key. */
/**
 * `fallback` is for keys built at runtime from data — a module's own snapshot field
 * names, for instance — where printing the key itself would be worse than printing
 * a tidied-up version of the data's own wording.
 */
export function translate(
  lang: Lang,
  key: string,
  vars: Record<string, string | number> = {},
  fallback?: string,
): string {
  const text =
    (DICT[lang] as Record<string, string>)[key] ??
    (DICT.en as Record<string, string>)[key] ??
    fallback ??
    key;
  return text.replace(/\{(\w+)\}/g, (_, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
  );
}

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (
    key: MessageKey | string,
    vars?: Record<string, string | number>,
    fallback?: string,
  ) => string;
}

const I18nContext = createContext<I18n | null>(null);
const STORAGE_KEY = "erp-lang";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("bn");

  // the saved choice (read after mount, so server and first client render agree)
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the saved language
    if (saved === "bn" || saved === "en") setLangState(saved);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }, []);
  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      t: (key, vars, fallback) => translate(lang, key, vars, fallback),
    }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}

/** The language currently chosen (for code outside React, e.g. the API client). */
export function currentLang(): Lang {
  if (typeof window === "undefined") return "bn";
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "en" ? "en" : "bn";
}
