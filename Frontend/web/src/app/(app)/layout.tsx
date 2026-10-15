'use client';
/** Every signed-in screen: session (who is signed in) + the app frame with the bottom navigation. */
import { AppShell } from '@/components/app-shell';
import { Loading } from '@/components/ui';
import { SessionProvider } from '@/lib/session';

export default function SignedInLayout({ children }: LayoutProps<'/'>) {
  return (
    <SessionProvider
      fallback={
        <div className="mx-auto max-w-lg px-4">
          <Loading />
        </div>
      }
    >
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
