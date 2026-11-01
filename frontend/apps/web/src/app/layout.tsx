import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { THEME_COLOR } from '@/lib/theme';
import './globals.css';

// Two local variable faces (never Google-hosted): Inter for body and UI, Plus Jakarta Sans for headings.
const inter = localFont({
  src: '../fonts/inter-latin-var.woff2',
  display: 'swap',
  variable: '--font-inter',
  weight: '100 900',
});

const jakarta = localFont({
  src: '../fonts/jakarta-latin-var.woff2',
  display: 'swap',
  variable: '--font-jakarta',
  weight: '200 800',
});

export const metadata: Metadata = {
  title: { default: 'SHRIII Behavioural Games', template: '%s · SHRIII' },
  description: 'Research console and kiosk for the SHRIII behavioural games.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    // suppressHydrationWarning: next-themes writes data-theme onto <html> before React hydrates.
    <html lang="en-IN" className={`${inter.variable} ${jakarta.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
