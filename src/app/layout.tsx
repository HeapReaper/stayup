import type { Metadata } from 'next';
import { Geist, Geist_Mono, Inter } from 'next/font/google';
import './globals.css';
import { cn } from "@/lib/utils";
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TRPCReactProvider } from '@/trpc/client';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'StayUp',
  description: 'Uptime monitor the way i like it',
  // The same mark the sidebar shows collapsed. This replaces the Next.js
  // template's src/app/favicon.ico, which was deleted rather than left in
  // place: Next emits a <link rel="icon" sizes="any"> for that file whenever
  // it exists, and browsers pick unpredictably between two competing icon
  // declarations.
  icons: {
    icon: [{ url: '/logo.webp', type: 'image/webp' }],
    apple: '/logo.webp',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-screen flex flex-col bg-background text-foreground">
        <NextThemesProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TRPCReactProvider>
            <TooltipProvider>
              <div className="flex-1 flex flex-col">
                {children}
              </div>
            </TooltipProvider>
          </TRPCReactProvider>

        </NextThemesProvider>
      </body>
    </html>
  );
}