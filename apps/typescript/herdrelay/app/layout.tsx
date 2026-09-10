import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HerdRelay — livestock incident coordination",
  description:
    "Human-approved livestock incident coordination: turns a synthetic respiratory monitoring alert into one approved CALL-E call to an authorized caretaker.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
