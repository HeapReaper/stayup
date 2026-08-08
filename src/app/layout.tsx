import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/core/navbar";
import Footer from "@/components/core/footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NextTemp",
  description: "The NextJS template i like",
};

export default function RootLayout({
                                     children,
                                   }: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
    <body className="min-h-screen flex flex-col bg-purple-50 text-purple-950 selection:bg-purple-200">
    <Navbar />
    <div className="flex-1 flex flex-col">{children}</div>
    <Footer />
    </body>
    </html>
  );
}