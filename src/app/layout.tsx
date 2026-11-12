import type { Metadata, Viewport } from "next";
import BrowserZoomGuard from "@/components/layout/BrowserZoomGuard";
import "./globals.css";

// App-wide metadata is the main place to customize browser and search-engine labels.
export const metadata: Metadata = {
  title: "Elevatorio - The vertical social space",
  description: "Pixel office world with floors, rooms and communication",
};

// Keep browser zoom disabled across the app; the world grids provide their own pinch zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// The root layout provides the shared HTML shell for every route.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <BrowserZoomGuard />
        {children}
      </body>
    </html>
  );
}
