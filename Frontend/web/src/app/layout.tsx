import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '@/components/service-worker';
import { I18nProvider } from '@/lib/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'My Office · আমার অফিস',
  description: 'Employee self-service: attendance, leave, payslips and approvals',
  applicationName: 'My Office',
  appleWebApp: { capable: true, title: 'My Office', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = {
  themeColor: '#047857',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="bn" className="h-full antialiased">
      <body className="min-h-full font-sans">
        <I18nProvider>{children}</I18nProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
