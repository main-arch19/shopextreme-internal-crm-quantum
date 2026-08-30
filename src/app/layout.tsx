import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inventory",
  description: "Internal inventory and stock control",
};

/**
 * Applies the stored theme before first paint.
 *
 * Without this the page renders in the OS theme, React hydrates, and the
 * stored choice is applied a frame later — a visible flash of the wrong
 * theme on every single load. It has to be inline and synchronous in <head>,
 * because anything deferred runs after the first paint by definition.
 *
 * Wrapped in try/catch: localStorage throws outright in some privacy modes,
 * and an uncaught error here would block rendering entirely.
 */
const themeScript = `
(function(){try{var t=localStorage.getItem('inventory.theme');
if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
