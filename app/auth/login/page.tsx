"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn, getSession, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Check,
  AlertCircle,
} from "lucide-react";

// Self-hosted from /public so the logo never depends on an external CDN
// (the previous storage.googleapis.com URL was blocked on some networks /
// ad-blockers, leaving a broken image on the login screen).
const LOGO_URL = "/donorhq-logo.png";

// useSearchParams() below requires a Suspense boundary for static
// prerendering (Next.js App Router bails out of the build otherwise —
// this page was failing `next build` / the Vercel deploy check because of
// it, unrelated to any data/API changes).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const message = searchParams.get("message");
    const trialStatus = searchParams.get("trial");
    if (trialStatus === "expired" && message) {
      setError(message);
    }
  }, [searchParams]);

  // Redirect if already logged in.
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      let redirectUrl = "/dashboard";
      if (session.user.role === "super_admin") redirectUrl = "/admin/manage-admins";
      else if (session.user.contactId) redirectUrl = `/contacts/${session.user.contactId}`;
      router.replace(redirectUrl);
    }
  }, [status, session, router]);

  // Already logged in → don't flash the form.
  if (status === "authenticated") return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/dashboard",
      });

      if (result?.ok) {
        // Wait briefly for the session cookie to settle.
        await new Promise((resolve) => setTimeout(resolve, 500));
        const session = await getSession();

        if (!session) {
          setError("Authentication failed. Please try again.");
          setLoading(false);
          return;
        }

        let redirectUrl = result?.url || "/dashboard";
        if (session.user.role === "super_admin") {
          redirectUrl = "/admin/manage-admins";
        } else if (session.user.role === "admin") {
          redirectUrl = "/dashboard";
        } else if (session.user.contactId) {
          redirectUrl = `/contacts/${session.user.contactId}`;
        } else {
          redirectUrl = "/contacts/14066";
        }

        router.push(redirectUrl);
      } else if (result?.error) {
        if (result.error.includes("suspended")) {
          setError("Your account has been suspended. Please contact an administrator.");
        } else {
          setError("Invalid credentials");
        }
      }
    } catch {
      setError("An error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ── Brand panel (desktop only) ─────────────────────────────────── */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-emerald-600 via-green-600 to-green-800 lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14">
        {/* Soft light bloom + subtle grid, purely decorative. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(60% 55% at 22% 18%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 60%), radial-gradient(45% 45% at 100% 100%, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 55%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(70% 60% at 50% 40%, black, transparent)",
          }}
        />

        {/* Brand lockup */}
        <div className="relative z-10 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-black/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_URL} alt="GiveSuite" className="h-8 w-8 object-contain" />
          </span>
          <div className="leading-tight text-white">
            <div className="text-lg font-semibold tracking-tight">DonorHQ</div>
            <div className="text-xs font-medium text-white/70">by GiveSuite</div>
          </div>
        </div>

        {/* Value proposition */}
        <div className="relative z-10 max-w-md text-white">
          <h1 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
            Every donor, every gift — in one place.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/80">
            The all-in-one platform to manage contacts, track donations, reconcile
            payments, and grow giving — built for modern nonprofits.
          </p>

          <ul className="mt-8 space-y-3">
            {[
              "Unified donor & donation records",
              "Real-time reconciliation across GHL & Crowded",
              "Reports and receipts your team can trust",
            ].map((line) => (
              <li key={line} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-white/25">
                  <Check className="h-3 w-3" />
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/* Trust line */}
        <div className="relative z-10 flex items-center gap-2 text-xs text-white/70">
          <ShieldCheck className="h-4 w-4" />
          Bank-grade security · Your data stays yours.
        </div>
      </aside>

      {/* ── Form panel ─────────────────────────────────────────────────── */}
      <main className="flex min-h-screen items-center justify-center px-6 py-12 lg:min-h-0">
        <div className="w-full max-w-sm">
          {/* Logo — visible on mobile, hidden on desktop (brand panel covers it). */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-11 w-11 place-items-center overflow-hidden rounded-2xl border bg-card shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO_URL} alt="GiveSuite" className="h-8 w-8 object-contain" />
            </span>
            <div className="leading-tight">
              <div className="text-lg font-semibold tracking-tight text-foreground">DonorHQ</div>
              <div className="text-xs font-medium text-muted-foreground">by GiveSuite</div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Welcome back
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Sign in to your account to continue.
            </p>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-5">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">
                Email address
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@organization.org"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="h-11 pl-10"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="h-11 pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-0 top-0 flex h-full items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full gap-2 bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-500"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Need access? Contact your workspace administrator.
          </p>
        </div>
      </main>
    </div>
  );
}
