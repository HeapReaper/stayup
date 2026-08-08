'use client';

import Link from 'next/link';
import Image from 'next/image';

export default function Navbar() {
  return (
    <nav className="border-b border-purple-100 bg-white backdrop-blur-sm sticky top-0 z-50 transition-colors">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/nexttemp.webp" alt="Logo" width={40} height={40} />
          <span className="text-xl font-bold tracking-tight text-purple-900">
            Next<span className="text-purple-600">Temp</span>
          </span>
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="text-sm font-medium text-purple-700 hover:text-purple-900 transition-colors"
          >
            Sign in
          </Link>

          <Link
            href="/register"
            className="text-sm font-medium text-purple-700 hover:text-purple-900 transition-colors"
          >
            Sign up
          </Link>

          <Link
            href="/logout"
            className="text-sm font-medium text-purple-700 hover:text-purple-900 transition-colors"
          >
            Sign out
          </Link>
          <a
            href="https://gitlab.com/heapreaper/nexttemp"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-purple-700 hover:text-purple-900 transition-colors"
          >
            Git repo
          </a>
        </div>
      </div>
    </nav>
  );
}
