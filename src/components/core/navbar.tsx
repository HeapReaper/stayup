'use client';

import Link from 'next/link';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Sun, Moon } from 'lucide-react';

export default function Navbar() {
  const { theme, setTheme } = useTheme();

  return (
    <nav className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-50 transition-colors">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground font-bold text-xl">
            N
          </div>
          <span className="text-xl font-bold tracking-tight text-foreground">
            Next<span className="text-primary">Temp</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>

          <Button variant="default" size="sm">
            <Link href="/register">Sign up</Link>
          </Button>

          <Button variant="ghost" size="sm">
            <Link href="/logout">Sign out</Link>
          </Button>

          <Button variant="outline" size="sm">
            <a
              href="https://gitlab.com/heapreaper/nexttemp"
              target="_blank"
              rel="noopener noreferrer"
            >
              Git repo
            </a>
          </Button>

          {/* Theme Toggle Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        </div>
      </div>
    </nav>
  );
}