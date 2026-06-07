import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider, themeBootstrapScript } from "@/components/ThemeProvider";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://worldcup.ptwconsultingllc.com"),
  title: "World Cup 2026 - Kitchen Table Bracket Pool",
  description: "Pick all 48 teams, ride your spirit team, win the pot. The Kitchen Table pool.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "World Cup 2026 - Kitchen Table Bracket Pool",
    description: "Pick all 48 teams, ride your spirit team, win the pot.",
    url: "https://worldcup.ptwconsultingllc.com",
    siteName: "Kitchen Table Bracket Pool",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
  // bracket wizard is a fixed-height app shell; don't let users zoom-jank it
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
