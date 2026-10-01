import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'EAG-Dashboard · SOLPRO', description: 'Fristen und Ablauf aller EAG-Förderungen', robots: { index: false } };
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#F7F7F8' }, { media: '(prefers-color-scheme: dark)', color: '#0B0B0C' }] };

// Darstellung wie in der App (gleicher Speicher-Schlüssel): vor dem ersten Zeichnen setzen, kein Aufblitzen
const THEMA = `try{var t=localStorage.getItem('eag_theme');if(t==='"hell"')document.documentElement.dataset.theme='light';else if(t==='"dunkel"')document.documentElement.dataset.theme='dark'}catch(e){}`;

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEMA }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
