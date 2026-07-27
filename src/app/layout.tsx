import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
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
 */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  // Variable-axis fonts (opsz/SOFT/WONK below) must leave `weight` unset —
  // next/font rejects combining a fixed weight array with axes.
  axes: ["opsz", "SOFT", "WONK"],
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500"],
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
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
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
                  var theme = stored ? stored[1] : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
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
