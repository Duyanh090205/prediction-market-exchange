import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  // Matches the repository and the way this project is named elsewhere. The tab
  // said "Trading Game Platform", which is the name of nothing a reader can look
  // up.
  title: {
    default: "Prediction-Market Exchange",
    template: "%s · Prediction-Market Exchange",
  },
  description:
    "A working prediction-market exchange: a central limit order book with price-time priority, a margin engine that reserves against worst-case loss, and atomic settlement.",
  // Needed for the generated opengraph-image to resolve to an absolute URL.
  // NEXTAUTH_URL is already the public origin on every deployment.
  metadataBase: new URL(process.env.NEXTAUTH_URL || "http://localhost:3000"),
  openGraph: {
    type: "website",
    siteName: "Prediction-Market Exchange",
    title: "Prediction-Market Exchange",
    description:
      "A central limit order book with price-time priority, a margin engine that reserves against worst-case loss, and atomic settlement. The book is readable without an account.",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
