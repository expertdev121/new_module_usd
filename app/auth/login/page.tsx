"use client";

import { useState } from "react";
import { signIn, getSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { navigateInParent } from "@/lib/iframe-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
      });

      console.log("SignIn result:", result);

      if (result?.ok) {
        console.log("Login successful, fetching session...");
        
        // Wait a bit for cookie to be set
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const session = await getSession();
        console.log("Session after login:", session);

        if (!session) {
          console.error("No session found after successful login!");
          setError("Authentication failed. Please try again.");
          setLoading(false);
          return;
        }

        // Navigate based on role
        const isInIframe = window.self !== window.top;
        let redirectUrl = "";

        if (session.user.role === "super_admin") {
          console.log("Redirecting to super admin dashboard...");
          redirectUrl = "/admin/manage-admins";
        } else if (session.user.role === "admin") {
          console.log("Redirecting to admin dashboard...");
          redirectUrl = "/dashboard";
        } else if (session.user.contactId) {
          console.log("Redirecting to contact page...");
          redirectUrl = `/contacts/${session.user.contactId}`;
        } else {
          console.log("Redirecting to default contacts page...");
          redirectUrl = "/contacts/14066";
        }

        if (isInIframe) {
          console.log("Using navigateInParent for iframe navigation");
          navigateInParent(redirectUrl);
        } else {
          console.log("Using window.location.href for navigation");
          window.location.href = redirectUrl;
        }
      } else if (result?.error) {
        console.error("Login error:", result.error);
        if (result.error.includes("suspended")) {
          setError("Your account has been suspended. Please contact an administrator.");
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
            {window.self !== window.top && (
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