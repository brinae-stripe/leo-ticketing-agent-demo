import type { Metadata, Viewport } from 'next';
import { Red_Hat_Display, Red_Hat_Text } from 'next/font/google';

import { SimBanner } from '@/components/layout/sim-banner';
import { SiteFooter, SiteHeader } from '@/components/layout/site-header';

import { Providers } from './providers';
import './globals.css';

const display = Red_Hat_Display({
  subsets: ['latin'],
  weight: ['500', '700', '900'],
  variable: '--font-display',
  display: 'swap',
});

const body = Red_Hat_Text({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'StageGate Ask — simulated agent demo',
    template: '%s · StageGate Ask',
  },
  description:
    'A fully simulated demo of an internal "ask an agent" experience for a fictional live-events ticketing platform running on Stripe Connect. No live Stripe connection.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="flex min-h-screen flex-col">
        <Providers>
          <SimBanner />
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
