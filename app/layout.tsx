import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const description = "A local-first, mode-seeking paper feed powered by authors, keywords, citation seeds, and DeepXiv.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;

  return {
    title: "Daily arXiv",
    description,
    openGraph: {
      title: "Daily arXiv",
      description,
      type: "website",
      images: [{ url: image, width: 1672, height: 941, alt: "Daily arXiv mode-seeking paper feed" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Daily arXiv",
      description,
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
