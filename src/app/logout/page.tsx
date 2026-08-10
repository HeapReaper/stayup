'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    async function handleLogout() {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            router.push('login');
            router.refresh();
          },
        },
      });
    }

    void handleLogout();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-purple-50">
      <p className="text-gray-600">Signing out...</p>
    </div>
  );
}