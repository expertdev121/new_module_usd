/**
 * Minimal centered layout for the OAuth install flow. Sits on top of the
 * global LayoutWrapper using `fixed inset-0 z-50` so the user lands on a
 * clean install-completion surface — no sidebar, no breadcrumb, no other
 * chrome — even though the parent LayoutWrapper still renders.
 *
 * Uses the same design tokens as the rest of the app (bg-background,
 * bg-card, Inter from globals.css).
 */
export default function OAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex min-h-screen items-center justify-center bg-background p-4">
      {children}
    </div>
  );
}
