"use client";

import { useState, useEffect } from "react";
import { signIn, getSession, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { navigateInParent } from "@/lib/iframe-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: session, status } = useSession();
  const router = useRouter();

  // 🧠 Redirect if already logged in
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      let redirectUrl = "/dashboard";

      if (session.user.role === "super_admin") redirectUrl = "/admin/manage-admins";
      else if (session.user.contactId) redirectUrl = `/contacts/${session.user.contactId}`;

      router.replace(redirectUrl);
    }
  }, [status, session, router]);

  // 🧱 If already logged in, don't show the login form
  if (status === "authenticated") return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    console.log("=== LOGIN DEBUG ===");
    console.log("Is in iframe:", window.self !== window.top);
    console.log("Current URL:", window.location.href);
    console.log("Attempting login...");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/dashboard", // ✅ ensures NextAuth returns the correct URL
      });

      console.log("SignIn result:", result);

      if (result?.ok) {
        console.log("Login successful, fetching session...");

        // Wait briefly for session cookie to set
        await new Promise((resolve) => setTimeout(resolve, 500));
        const session = await getSession();
        console.log("Session after login:", session);

        if (!session) {
          console.error("No session found after successful login!");
          setError("Authentication failed. Please try again.");
          setLoading(false);
          return;
        }

        // Determine where to go next
        const isInIframe = window.self !== window.top;
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

        console.log("Redirecting to:", redirectUrl);

        // Navigate based on context (iframe or not)
        if (isInIframe) {
          console.log("Using navigateInParent for iframe navigation");
          navigateInParent(redirectUrl);
        } else {
          console.log("Using router.push for normal navigation");
          router.push(redirectUrl);
        }
      } else if (result?.error) {
        console.error("Login error:", result.error);
        if (result.error.includes("suspended")) {
          setError(
            "Your account has been suspended. Please contact an administrator."
          );
        } else {
          setError("Invalid credentials");
        }
      }
    } catch (err) {
      console.error("Login exception:", err);
      setError("An error occurred during login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Login</CardTitle>
          <CardDescription>
            Enter your credentials to access the admin dashboard
            {typeof window !== "undefined" && window.self !== window.top && (
              <span className="block mt-2 text-blue-600 text-xs">
                (Running in iframe mode)
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                  autoComplete="current-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}