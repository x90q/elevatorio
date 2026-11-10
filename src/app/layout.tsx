import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "elevator",
  description: "Pixel office world with floors, rooms and communication",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
