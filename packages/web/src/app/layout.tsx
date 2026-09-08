import type { Metadata } from "next";
import { Inter, Space_Grotesk, Caveat } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/app-providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin"],
  weight: ["700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXTAUTH_URL ?? "https://pew.md"
  ),
  title: "pew - AI Token Usage Dashboard",
  description: "The contribution graph for AI-native developers",
  openGraph: {
    title: "pew - AI Token Usage Dashboard",
    description: "The contribution graph for AI-native developers",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply dark class before first paint to prevent FOUC */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: inline anti-FOUC script must run before hydration to prevent light/dark flash; content is a static string literal owned by this file.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme:dark)").matches;var isDark=s==="dark"||(s!=="light"&&d);var el=document.documentElement;el.classList.toggle("dark",isDark);el.classList.toggle("light",!isDark);el.dataset.mode=isDark?"dark":"light";var p=isDark?"270 90% 65%":"270 85% 52%";el.style.setProperty("--basalt-primary",p);el.style.setProperty("--basalt-primary-foreground",isDark?"270 100% 98%":"0 0% 100%");el.style.setProperty("--basalt-ring",p);el.dataset.accent="primary"}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${spaceGrotesk.variable} ${caveat.variable} antialiased`}
      >
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
