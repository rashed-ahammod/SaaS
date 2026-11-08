/**
 * The notices an employee agrees to (spec §11 "consent recorded for biometric and
 * selfie attendance data"). Each consent row stores the notice version it was
 * given under; changing a text means a new version, and HR can see who agreed
 * to which one.
 *
 * ILLUSTRATIVE wording until counsel confirms it against Bangladesh's data
 * protection law in force (spec §11).
 */
import type { ConsentPurpose } from '../../platform/db/schema.js';

export const CONSENT_PURPOSES: ConsentPurpose[] = [
  'biometric_attendance',
  'location_attendance',
  'selfie_attendance',
];

export const CONSENT_NOTICES: Record<
  ConsentPurpose,
  { version: string; en: string; bn: string }
> = {
  biometric_attendance: {
    version: 'biometric-2026.1',
    en: 'The office attendance device reads your fingerprint or face to record when you arrive and leave. The fingerprint or face template stays on the device; the ERP keeps only your device number and the punch times, for attendance and payroll. You can withdraw this consent at any time and use another way to record attendance agreed with HR.',
    bn: 'অফিসের হাজিরা মেশিন আপনার আঙুলের ছাপ বা মুখ পড়ে আসা-যাওয়ার সময় রেকর্ড করে। আঙুলের ছাপ বা মুখের তথ্য মেশিনেই থাকে; ইআরপি শুধু আপনার মেশিন নম্বর ও পাঞ্চের সময় রাখে, হাজিরা ও বেতনের জন্য। আপনি যেকোনো সময় এই সম্মতি প্রত্যাহার করে HR-এর সাথে ঠিক করা অন্য উপায়ে হাজিরা দিতে পারবেন।',
  },
  location_attendance: {
    version: 'location-2026.1',
    en: "When you punch from your phone, the app sends your phone's location once, to check that you are inside the office area. Your location is not tracked at other times. The exact location of a punch is deleted after 6 months; the punch time is kept. You can withdraw this consent at any time; you will then punch on the office device instead.",
    bn: 'ফোন থেকে পাঞ্চ করলে অ্যাপ একবার আপনার ফোনের অবস্থান পাঠায়, আপনি অফিস এলাকার ভেতরে আছেন কিনা দেখতে। অন্য কোনো সময় আপনার অবস্থান দেখা হয় না। পাঞ্চের সঠিক অবস্থান ৬ মাস পর মুছে ফেলা হয়; পাঞ্চের সময় থেকে যায়। আপনি যেকোনো সময় এই সম্মতি প্রত্যাহার করতে পারবেন; তখন অফিসের মেশিনে পাঞ্চ করবেন।',
  },
  selfie_attendance: {
    version: 'selfie-2026.1',
    en: 'If your company turns on photo punches, the app takes a photo when you punch, to confirm it is you. Photos are used only for attendance checks and deleted after 90 days. You can withdraw this consent at any time.',
    bn: 'আপনার কোম্পানি ছবিসহ পাঞ্চ চালু করলে, পাঞ্চের সময় অ্যাপ একটি ছবি তুলবে যাতে নিশ্চিত হওয়া যায় এটি আপনি। ছবি শুধু হাজিরা যাচাইয়ে ব্যবহার হয় এবং ৯০ দিন পর মুছে ফেলা হয়। আপনি যেকোনো সময় এই সম্মতি প্রত্যাহার করতে পারবেন।',
  },
};
