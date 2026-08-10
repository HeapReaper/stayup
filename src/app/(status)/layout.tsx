// Layout for public, unauthenticated status pages (/status/[slug]). Deliberately
// bare — no dashboard chrome (sidebar/topbar) — the root layout already
// provides fonts, the theme provider, tRPC, and tooltips.
export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
