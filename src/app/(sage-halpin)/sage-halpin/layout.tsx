import './sage-halpin.css';
import type { Metadata, Viewport } from 'next';

// Sage Halpin has its own root layout: it is a public brand site, not a screen
// of the MetaMSP platform, and must not inherit the platform shell or styles.

export const metadata: Metadata = {
  title: 'Sage Halpin — The Evolving Board',
  description:
    'A continuously evolving board of people and agentic advisers. The roster evolves. The knowledge compounds.',
};

export const viewport: Viewport = {
  themeColor: '#13232B',
};

export default function SageHalpinLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Newsreader and Inter are both SIL Open Font Licence. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,300;1,6..72,400&display=swap"
        />
      </head>
      <body className="sh">{children}</body>
    </html>
  );
}
