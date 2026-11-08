"use client";
/** HR / Admin portal (WP13): session, selected company and the desktop frame. */
import { PortalProvider } from "@/components/portal/portal-context";
import { PortalShell } from "@/components/portal/portal-shell";
import { Loading } from "@/components/ui";
import { SessionProvider } from "@/lib/session";

export default function PortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <SessionProvider
      fallback={
        <div className="mx-auto max-w-lg px-4">
          <Loading />
        </div>
      }
    >
      <PortalProvider>
        <PortalShell>{children}</PortalShell>
      </PortalProvider>
    </SessionProvider>
  );
}
