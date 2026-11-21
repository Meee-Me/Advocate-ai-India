import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Advocate AI India', template: '%s · Advocate AI India' },
  description: 'AI assistant for Indian advocates: legal research, drafting, document analysis, case and hearing management.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: '#3b2a6e', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
