import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TermForge — Scientific Lexicon',
  description: 'Private, local-first scientific terminology workspace.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
