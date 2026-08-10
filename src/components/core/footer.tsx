import React from 'react';

export default function Footer() {
  return (
    <footer className="border-t bg-background text-muted-foreground">
      <div className="container max-w-7xl mx-auto px-6 py-8 text-center text-sm font-medium">
        <p>&copy; {new Date().getFullYear()} NextTemp. Made with 💜</p>
      </div>
    </footer>
  );
}