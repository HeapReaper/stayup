import Navbar from '@/components/core/navbar';
import Footer from '@/components/core/footer';
import React from 'react';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />

      <main className="flex-1 flex flex-col">
        {children}
      </main>

      <Footer />
    </>
  );
}