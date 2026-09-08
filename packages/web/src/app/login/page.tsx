"use client";

import { Button } from "@nocoo/basalt/components/button";
import { Input } from "@nocoo/basalt/components/input";
import { LoadingScreen } from "@nocoo/basalt/components/loading-screen";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Suspense, useState } from "react";
import { BadgeAmbientGlow, BadgeCard } from "@/components/brand/badge-card";
import { Github } from "@/components/icons/github";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SiteFooter } from "@/components/layout/site-footer";

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const rawCallback = searchParams.get("callbackUrl");
  const callbackUrl = rawCallback?.startsWith("/") && !rawCallback.startsWith("//") ? rawCallback : "/dashboard";

  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleGoogleLogin = () => {
    signIn("google", { callbackUrl });
  };

  const handleInviteSubmit = async () => {
    setInviteError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        // Cookie is set by the server — now trigger Google sign-in
        signIn("google", { callbackUrl });
      } else {
        setInviteError(data.error ?? "Invalid or already used invite code");
      }
    } catch {
      setInviteError("Network error. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-basalt-background">
      <div className="flex flex-1 items-center justify-center p-4">
        <BadgeAmbientGlow />

        <div className="absolute top-4 right-4 z-10 flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <a
              href="https://github.com/nocoo/pew"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub repository"
            >
              <Github className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.5} />
            </a>
          </Button>
          <ThemeToggle />
        </div>

        <div className="flex flex-col items-center">
          <BadgeCard
            badge="DEV"
            className="w-72"
            contentClassName="items-center px-6 pt-6 pb-5"
            footer={
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                <span className="text-[10px] text-basalt-muted-foreground">Secure Auth</span>
              </div>
            }
          >
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-basalt-secondary p-2.5 ring-1 ring-basalt-border">
              <Image src="/logo-80.png" alt="pew" width={80} height={80} />
            </div>

            <p className="mt-5 text-lg font-semibold text-basalt-foreground">Show your tokens</p>
            <p className="mt-1 text-xs text-basalt-muted-foreground">Sign in to view your dashboard</p>

            {error && error !== "InviteRequired" && (
              <div className="mt-3 w-full rounded-lg bg-basalt-destructive/10 px-3 py-2 text-center text-xs text-basalt-destructive">
                {error === "AccessDenied"
                  ? "Your account is not authorized to access this application."
                  : "Sign in failed. Please try again."}
              </div>
            )}

            <div className="mt-5 h-px w-full bg-basalt-border" />
            <div className="mt-5" />

            {error === "InviteRequired" ? (
              <div className="w-full space-y-3">
                <p className="text-center text-xs text-basalt-muted-foreground">
                  An invite code is required to create your account.
                </p>
                <Input
                  type="text"
                  maxLength={8}
                  placeholder="Enter invite code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && inviteCode.trim().length > 0 && !verifying) {
                      handleInviteSubmit();
                    }
                  }}
                  className="rounded-xl py-3 text-center font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal"
                />
                {inviteError && (
                  <div className="w-full rounded-lg bg-basalt-destructive/10 px-3 py-2 text-center text-xs text-basalt-destructive">
                    {inviteError}
                  </div>
                )}
                <Button
                  variant="secondary"
                  className="w-full rounded-xl py-3"
                  onClick={handleInviteSubmit}
                  disabled={inviteCode.trim().length === 0 || verifying}
                  loading={verifying}
                >
                  <GoogleIcon />
                  {verifying ? "Verifying..." : "Verify & Sign In"}
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                className="w-full rounded-xl py-3"
                onClick={handleGoogleLogin}
              >
                <GoogleIcon />
                Sign in with Google
              </Button>
            )}

            <p className="mt-3 text-center text-[10px] leading-relaxed text-basalt-muted-foreground/60">
              By signing in you agree to our{" "}
              <a
                href="/privacy"
                className="underline transition-colors hover:text-basalt-muted-foreground"
              >
                privacy policy
              </a>
            </p>
          </BadgeCard>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <LoadingScreen
          label="Loading"
          mark={<Image src="/logo-24.png" alt="" width={32} height={32} />}
        />
      }
    >
      <LoginContent />
    </Suspense>
  );
}
