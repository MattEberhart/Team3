import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://second-serving.savory-wand-5883.chatgpt.site'),
  title: 'Second Serving — Good food, still in time',
  description: 'Reserve surplus meals and ingredients from kitchens near you.',
  openGraph: {
    title: 'Second Serving',
    description: 'Good food, still in time.',
    images: [{ url: '/og.png', width: 1677, height: 943, alt: 'Second Serving — Good food, still in time.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Second Serving',
    description: 'Good food, still in time.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
