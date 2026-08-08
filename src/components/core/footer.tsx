import React from 'react';

export default async function Footer() {
  return (
    <>
      <footer className="border-t border-purple-100 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 text-center text-purple-600/80 text-sm font-medium">
          <p>&copy; {new Date().getFullYear()} NextTemp. Made with 💜</p>
        </div>
      </footer>
    </>
  )
}