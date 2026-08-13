import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  return {
    metadataBase: new URL(`${protocol}://${host}`),
    title: "Model Tasting Kitchen",
    description: "A quiet, browser-local field notebook for manually comparing model encounters.",
    icons: { icon: "/favicon.svg" },
    openGraph: { title: "Model Tasting Kitchen", description: "A quiet place to compare how models think.", images: ["/og.png"] },
    twitter: { card: "summary_large_image", title: "Model Tasting Kitchen", description: "A quiet place to compare how models think.", images: ["/og.png"] },
  };
}

export const viewport: Viewport = { themeColor: "#f5f0e7" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
