"use client";
/**
 * Who is signed in, for every page of the app.
 *
 *   const { me, profile, isApprover, signOut } = useSession();
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, isMfaSetupRequired } from "./api";
import { useI18n } from "./i18n";
import type { Me, Profile } from "./types";

interface Session {
  me: Me;
  /** The linked employee record (null if the login has no employee). */
  profile: Profile | null;
  /** Has a role besides "employee" (Dept Head, HR ...), so may have approvals. */
  isApprover: boolean;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState<ApiError | null>(null);
  const { setLang } = useI18n();

  const loadProfile = async (user: Me) => {
    if (!user.employeeId) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await api.get<Profile>("/me/profile"));
    } catch (e) {
      // Not a failure to show: this user has to set 2FA up first, and the card
      // that does it is on /profile — the page we are about to render.
      if (!isMfaSetupRequired(e)) throw e;
      setProfile(null);
    }
  };

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/session", { cache: "no-store" });
      if (res.status === 401) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload on purpose: clears personal data held in memory
        window.location.assign(
          `/login?next=${encodeURIComponent(window.location.pathname)}`,
        );
        return;
      }
      if (!res.ok) {
        setFailed(new ApiError(res.status, "SESSION", "Session check failed"));
        return;
      }
      const user = (await res.json()) as Me;
      // first visit on this phone: use the language saved on the account
      if (!localStorage.getItem("erp-lang")) setLang(user.preferredLanguage);
      await loadProfile(user);
      setMe(user);
    })().catch((e: ApiError) => setFailed(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per page load
  }, []);

  const value = useMemo<Session | null>(
    () =>
      me && {
        me,
        profile,
        isApprover: me.roles.some((r) => !r.startsWith("employee:")),
        reloadProfile: () => loadProfile(me),
        signOut: async () => {
          await fetch("/api/session", {
            method: "DELETE",
            headers: { "x-erp-client": "pwa" },
          });
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload on purpose: clears personal data held in memory
          window.location.assign("/login");
        },
      },
    [me, profile],
  );

  if (failed) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center">
        <p className="mb-3">
          সার্ভারে সংযোগ করা যাচ্ছে না। / The server cannot be reached.
        </p>
        <button
          className="rounded-xl bg-emerald-700 px-4 py-2.5 font-semibold text-white"
          onClick={() => window.location.reload()}
        >
          আবার চেষ্টা করুন / Try again
        </button>
      </div>
    );
  }
  if (!value) return <>{fallback}</>;
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
