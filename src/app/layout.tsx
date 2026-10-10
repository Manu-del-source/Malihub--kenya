import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/providers/theme-provider";
import { QueryProvider } from "@/providers/query-provider";
import "./globals.css";

/**
 * Type system (finalized in Phase 3):
 * - Fraunces (display) — a warm, optical-size-aware serif used ONLY for
 *   large headlines, set with restraint. Gives the premium/editorial read
 *   Apple/Airbnb-tier marketing sites have, without leaning on the generic
 *   "cream + serif + terracotta" template — our canvas is dark ink, not
 *   cream, and the accent is a golder copper, not terracotta.
 * - Plus Jakarta Sans (body/UI) — geometric but slightly rounded, reads
 *   cleanly at small sizes for nav, buttons, form labels, and body copy.
 * - JetBrains Mono (data) — tabular figures for prices and stat counters,
 *   so numbers align and feel deliberately "data-like" rather than prose.
 *
 * The fonts are self-hosted (src/app/fonts, see the README there) rather than
 * loaded through next/font/google. That loader downloads from Google at build
 * time and crashes (`Cannot read properties of null (reading '1')`) whenever
 * Google answers with an extensionless /l/font?kit= URL — an intermittent
 * upstream failure (vercel/next.js#99114) that broke production builds.
 * Do not switch these back to next/font/google.
 */
const fraunces = localFont({
  src: "./fonts/fraunces-latin-variable.woff2",
  variable: "--font-display",
  display: "swap",
  // Full variable file: wght 100–900 plus opsz 9–144, SOFT 0–100, WONK 0–1.
  // opsz tracks font size automatically (font-optical-sizing: auto). No CSS
  // sets font-variation-settings, so SOFT and WONK stay at the font's defaults.
  weight: "100 900",
  style: "normal",
  adjustFontFallback: "Times New Roman",
});

const plusJakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin-variable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "200 800",
  style: "normal",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-variable.woff2",
  variable: "--font-mono",
  display: "swap",
  // Variable file (100–800) clamped to the two weights previously requested.
  weight: "400 500",
  style: "normal",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://malihub.co.ke"),
  title: {
    default: "MaliHub Kenya — Buy & Sell Anything, Anywhere in Kenya",
    template: "%s | MaliHub Kenya",
  },
  description:
    "MaliHub Kenya is a premium marketplace to buy and sell vehicles, property, electronics, fashion, and more — with secure M-Pesa payments and verified sellers across all 47 counties.",
  keywords: [
    "Kenya marketplace",
    "buy and sell Kenya",
    "M-Pesa marketplace",
    "online marketplace Kenya",
    "classifieds Kenya",
  ],
  openGraph: {
    type: "website",
    locale: "en_KE",
    siteName: "MaliHub Kenya",
    title: "MaliHub Kenya — Buy & Sell Anything, Anywhere in Kenya",
    description:
      "A premium marketplace to buy and sell across Kenya, with secure M-Pesa payments and verified sellers.",
  },
  twitter: {
    card: "summary_large_image",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F68B1E" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0e14" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before hydration to avoid a light/dark flash on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var stored = document.cookie.match(/malihub-theme=(dark|light)/);
                  var theme = stored ? stored[1] : 'light';
                  document.documentElement.classList.toggle('dark', theme === 'dark');
                  document.documentElement.style.colorScheme = theme;
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${fraunces.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <ThemeProvider>
          <QueryProvider>
            {children}
            <Toaster
              position="top-center"
              richColors
              closeButton
              theme="system"
            />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
