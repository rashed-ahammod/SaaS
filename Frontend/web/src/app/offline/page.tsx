/** Shown by the service worker when there is no internet and the page was never opened before. */
import Link from "next/link";
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-bold">ইন্টারনেট সংযোগ নেই</h1>
      <p className="text-slate-600">
        No internet connection. Please check mobile data or Wi-Fi and try again.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white"
      >
        আবার চেষ্টা করুন / Try again
      </Link>
    </main>
  );
}
