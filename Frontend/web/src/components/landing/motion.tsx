"use client";
/**
 * Movement for the landing page (/). It is deliberately small: rules draw
 * themselves, rows arrive, figures count, and the payroll rail fills as you
 * read down it. Nothing here carries meaning on its own — with JavaScript off,
 * or "reduce motion" set in the operating system, the page reads exactly the
 * same (see the landing block at the end of globals.css).
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
function useSeen<T extends HTMLElement>(margin = "0px 0px -10% 0px") {
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
      { rootMargin: margin, threshold: 0.05 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin]);
  return { ref, seen };
}

/** Brings its children in when they reach the screen. */
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
  duration = 1100,
}: {
  to: number;
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
      setShown(Math.round(to * (1 - Math.pow(1 - part, 3))));
      if (part < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [seen, to, duration]);
  return <span ref={ref}>{shown}</span>;
}

/**
 * The payroll run sheet's left rail: a hairline that fills with the accent
 * colour as the reader moves down the ten steps.
 */
export function Rail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [part, setPart] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = node.getBoundingClientRect();
      const mark = window.innerHeight * 0.55;
      setPart(Math.max(0, Math.min(1, (mark - box.top) / box.height)));
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
    <div
      ref={ref}
      className="landing-rail relative"
      style={{ "--rail": `${part * 100}%` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** A thin accent line across the top showing how far down the page we are. */
export function Progress() {
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
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-px">
      <div
        className="h-full w-full origin-left bg-accent"
        style={{ transform: `scaleX(${part})` }}
      />
    </div>
  );
}

const SECTIONS = [
  { href: "#problem", label: "Problem" },
  { href: "#answer", label: "Answer" },
  { href: "#payroll", label: "Payroll" },
  { href: "#ai", label: "AI" },
  { href: "#automation", label: "Automation" },
  { href: "#compliance", label: "Compliance" },
  { href: "#plans", label: "Plans" },
];

/** The top bar, and on wide screens the current section is marked. */
export function Nav() {
  const [moved, setMoved] = useState(false);
  const [open, setOpen] = useState(false);
  const [here, setHere] = useState("");

  useEffect(() => {
    const onScroll = () => {
      setMoved(window.scrollY > 16);
      // back at the hero: no section is the current one
      if (window.scrollY < 240) setHere("");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const bands = SECTIONS.map((s) =>
      document.querySelector(s.href),
    ).filter((el): el is Element => el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target.id) setHere(`#${top.target.id}`);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const band of bands) observer.observe(band);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-300 ${
        moved ? "border-b border-line bg-ink/90 backdrop-blur-md" : ""
      }`}
    >
      <div className="mx-auto flex max-w-[76rem] items-stretch gap-4 px-5 sm:px-8">
        <a href="#top" className="flex items-center gap-3 py-3.5">
          <span className="grid size-8 place-items-center border border-line text-sm font-bold text-accent">
            অ
          </span>
          <span className="font-ledger text-[11px] tracking-[0.22em] text-paper uppercase">
            Amar Office
          </span>
        </a>

        <nav className="ml-auto hidden items-stretch lg:flex">
          {SECTIONS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={here === item.href ? "true" : undefined}
              className={`flex items-center border-b-2 px-3.5 font-ledger text-[10px] tracking-[0.16em] uppercase transition-colors ${
                here === item.href
                  ? "border-accent text-paper"
                  : "border-transparent text-faint hover:text-paper"
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-5">
          <Link
            href="/login"
            className="border border-line px-4 py-2 font-ledger text-[10px] tracking-[0.18em] text-paper uppercase transition hover:border-accent hover:text-accent"
          >
            Sign in
          </Link>
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-label="Sections"
            className="border border-line p-2 text-muted transition hover:text-paper lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"}
              />
            </svg>
          </button>
        </div>
      </div>

      <div
        className={`overflow-hidden border-t border-line bg-ink/95 backdrop-blur-md transition-[max-height] duration-400 lg:hidden ${
          open ? "max-h-96" : "max-h-0 border-t-transparent"
        }`}
      >
        <ul className="grid grid-cols-2">
          {SECTIONS.map((item) => (
            <li key={item.href} className="border-r border-b border-line">
              <a
                href={item.href}
                onClick={() => setOpen(false)}
                className="block px-5 py-3.5 font-ledger text-[10px] tracking-[0.16em] text-muted uppercase active:text-accent"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}
