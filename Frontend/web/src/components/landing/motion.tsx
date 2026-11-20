"use client";
/**
 * Movement for the public landing page (/landing). Everything here is cosmetic:
 * with JavaScript off, or with "reduce motion" switched on in the operating
 * system, the page still shows every word (the rules at the end of globals.css
 * make sure of it).
 */
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

const calmer = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** True once the element has been scrolled into view, and then it stays true. */
function useSeen<T extends HTMLElement>(margin = "0px 0px -12% 0px") {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // No observer in this browser: show everything rather than nothing.
      const timer = setTimeout(() => setSeen(true), 0);
      return () => clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin, threshold: 0.08 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin]);
  return { ref, seen };
}

/** Fades and lifts its children in when they reach the screen. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, seen } = useSeen<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={className}
      data-reveal={seen ? "in" : "out"}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** Counts up to a number the first time it is seen. */
export function Counter({
  to,
  suffix = "",
  duration = 1300,
}: {
  to: number;
  suffix?: string;
  duration?: number;
}) {
  const { ref, seen } = useSeen<HTMLSpanElement>();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!seen) return;
    let frame = 0;
    if (calmer()) {
      frame = requestAnimationFrame(() => setShown(to));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    const step = (now: number) => {
      const part = Math.min(1, (now - start) / duration);
      // ease-out: quick at first, then settles on the number
      setShown(Math.round(to * (1 - Math.pow(1 - part, 3))));
      if (part < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [seen, to, duration]);
  return (
    <span ref={ref}>
      {shown}
      {suffix}
    </span>
  );
}

/** A thin bar across the top showing how far down the page the reader is. */
export function ScrollProgress() {
  const [part, setPart] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      setPart(height > 0 ? Math.min(1, window.scrollY / height) : 0);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5">
      <div
        className="h-full w-full origin-left bg-gradient-to-r from-emerald-400 via-teal-300 to-sky-400 transition-transform duration-150"
        style={{ transform: `scaleX(${part})` }}
      />
    </div>
  );
}

const SECTIONS = [
  { href: "#problem", en: "The problem", bn: "সমস্যা" },
  { href: "#solution", en: "The answer", bn: "সমাধান" },
  { href: "#payroll", en: "Payroll", bn: "পেরোল" },
  { href: "#ai", en: "AI", bn: "এআই" },
  { href: "#automation", en: "Automation", bn: "অটোমেশন" },
  { href: "#compliance", en: "Compliance", bn: "কমপ্লায়েন্স" },
  { href: "#pricing", en: "Plans", bn: "প্ল্যান" },
];

/** Top bar: see-through over the hero, frosted once the page moves. */
export function LandingNav() {
  const [moved, setMoved] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setMoved(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-all duration-500 ${
        moved
          ? "border-b border-white/10 bg-[#070b14]/85 shadow-lg shadow-black/30 backdrop-blur-xl"
          : "border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center gap-3 px-5 py-3 sm:px-8 sm:py-4">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-base font-bold text-[#04130f] shadow-lg shadow-emerald-500/25">
            অ
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-tight text-white">
              Amar Office
            </span>
            <span className="text-[10px] font-semibold tracking-[0.18em] text-emerald-300/70 uppercase">
              ERP · CRM
            </span>
          </span>
        </a>

        <ul className="ml-auto hidden items-center gap-0.5 lg:flex">
          {SECTIONS.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
              >
                {item.en}
              </a>
            </li>
          ))}
        </ul>

        <Link
          href="/login"
          className="ml-auto rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#06120f] transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-400/25 lg:ml-3"
        >
          Sign in
        </Link>

        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-label="Sections"
          className="rounded-xl border border-white/15 p-2 text-slate-200 transition hover:bg-white/5 lg:hidden"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"}
            />
          </svg>
        </button>
      </nav>

      <div
        className={`overflow-hidden border-t border-white/10 bg-[#070b14]/95 backdrop-blur-xl transition-all duration-500 lg:hidden ${
          open ? "max-h-96" : "max-h-0 border-t-transparent"
        }`}
      >
        <ul className="grid grid-cols-2 gap-1 p-4">
          {SECTIONS.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-2.5 text-sm text-slate-300 transition active:bg-white/10"
              >
                {item.en}
                <span className="ml-1.5 text-xs text-slate-500">{item.bn}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
