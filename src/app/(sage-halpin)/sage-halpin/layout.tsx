import './sage-halpin.css';
import type { Metadata, Viewport } from 'next';

// Sage Halpin has its own root layout: it is a public brand site, not a screen
// of the MetaMSP platform, and must not inherit the platform shell or styles.

export const metadata: Metadata = {
  title: 'Sage Halpin — The Evolving Board',
  description:
    'An evolving team of people and agentic advisers that scales and flexes with the ever-changing needs of your organisation. The team evolves. The knowledge compounds.',
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
        {/* Unbounded and Figtree are both SIL Open Font Licence. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Unbounded:wght@300;400;500&family=Figtree:ital,wght@0,400;0,500;0,600;1,400&display=swap"
        />
      </head>
      <body className="sh">{children}</body>
    </html>
  );
}
