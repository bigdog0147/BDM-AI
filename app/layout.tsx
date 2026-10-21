import type { Metadata, Viewport } from "next";
import "./styles.css";
import SWRegister from "./components/SWRegister";

export const metadata: Metadata = {
  title: "BDM — Personal AI",
  description:
    "BDM is a private personal AI workspace: chat, long-term memory, voice notes and sourced web research.",
  applicationName: "BDM Personal AI",
  manifest: "/manifest.json",
  openGraph: {
    title: "BDM — Personal AI",
    description:
      "A private personal AI workspace with memory, voice notes and sourced web research.",
    type: "website"
  }
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  colorScheme: "dark"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#07090d" />
      </head>
      <body>
        {children}
        <SWRegister />
      </body>
    </html>
  );
}