import type { Metadata, Viewport } from "next";
import Providers from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AfghanGPT — د افغانانو مرستیال",
  description:
    "AfghanGPT — free AI assistant by Abdul Samim Niazai. Ask anything: programming, websites, English and more.",
};

// interactive-widget=resizes-content: when the Android keyboard
// opens, the visual viewport resizes (instead of overlaying), so
// the dvh-sized chat shell shrinks and the header + composer stay
// visible instead of scrolling away.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ps" dir="rtl">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
