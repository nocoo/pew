import type { Metadata } from "next";
import type { CSSProperties } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { AppProviders } from "@/components/app-providers";
import { CHART_ANIMATION } from "@/lib/chart-animation";

const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk-latin-wght-normal.woff2",
  variable: "--font-space-grotesk",
  weight: "400 700",
  display: "swap",
});

const caveat = localFont({
  src: "./fonts/caveat-latin-wght-normal.woff2",
  variable: "--font-caveat",
  weight: "700",
  display: "swap",
});

type HexlyShare = {
  name: string;
  description: { en: string };
  image: {
    url: string;
    type: string;
    width: number;
    height: number;
    alt: string;
  };
};

async function hexlyShare(): Promise<HexlyShare> {
  try {
    const response = await fetch("https://hexly.ai/api/share/pew.json");
    if (!response.ok) throw new Error(`hexly share ${response.status}`);
    return response.json();
  } catch {
    return {
      name: "Pew",
      description: {
        en: "A contribution graph for the AI-native era. See your coding tokens tell a story.",
      },
      image: {
        url: "https://hexly.ai/og/pew.jpg",
        type: "image/jpeg",
        width: 1200,
        height: 630,
        alt: "Pew identity",
      },
    };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const share = await hexlyShare();
  return {
    metadataBase: new URL(process.env.NEXTAUTH_URL ?? "https://pew.md"),
    title: "pew - AI Token Usage Dashboard",
    description: share.description.en,
    openGraph: {
      title: share.name,
      description: share.description.en,
      type: "website",
      url: "https://pew.md/",
      images: [
        {
          url: share.image.url,
          type: share.image.type,
          width: share.image.width,
          height: share.image.height,
          alt: share.image.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: share.name,
      description: share.description.en,
      images: [share.image.url],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={
        {
          "--chart-animation-duration": `${CHART_ANIMATION.animationDuration}ms`,
          "--chart-animation-easing": CHART_ANIMATION.animationEasing,
          "--chart-animation-delay": `${CHART_ANIMATION.animationBegin}ms`,
        } as CSSProperties
      }
    >
      <head>
        {/* Apply dark class before first paint to prevent FOUC */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: inline anti-FOUC script must run before hydration to prevent light/dark flash; content is a static string literal owned by this file.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem("theme");var d=window.matchMedia("(prefers-color-scheme:dark)").matches;var isDark=s==="dark"||(s!=="light"&&d);var el=document.documentElement;el.classList.toggle("dark",isDark);el.classList.toggle("light",!isDark);el.dataset.mode=isDark?"dark":"light";var p=isDark?"270 90% 65%":"270 85% 52%";el.style.setProperty("--basalt-primary",p);el.style.setProperty("--basalt-primary-foreground",isDark?"270 100% 98%":"0 0% 100%");el.style.setProperty("--basalt-ring",p);el.dataset.accent="primary"}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable} ${caveat.variable} antialiased`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
