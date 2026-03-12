/**
 * Auth.js v5 configuration for pew SaaS.
 *
 * Uses JWT strategy (no session table needed) with Google OAuth.
 * User data stored in Cloudflare D1 via custom adapter.
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { D1AuthAdapter } from "@/lib/auth-adapter";
import { getD1Client } from "@/lib/d1";
import { handleInviteGate } from "@/lib/invite";
import type { JWT } from "next-auth/jwt";
import type { Session, User } from "next-auth";

// ---------------------------------------------------------------------------
// Exported helpers (testable without next-auth runtime)
// ---------------------------------------------------------------------------

/** Determine whether to use __Secure- prefixed cookies. */
export function shouldUseSecureCookies(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.NEXTAUTH_URL?.startsWith("https://") === true ||
    process.env.USE_SECURE_COOKIES === "true"
  );
}

/** Persist user ID into the JWT token. */
export function jwtCallback({
  token,
  user,
}: {
  token: JWT;
  user?: User;
}): JWT {
  if (user?.id) {
    token.userId = user.id;
  }
  return token;
}

/** Expose user ID in the session object. */
export function sessionCallback({
  session,
  token,
}: {
  session: Session;
  token: JWT;
}): Session {
  if (token.userId && session.user) {
    session.user.id = token.userId as string;
  }
  return session;
}

// ---------------------------------------------------------------------------
// NextAuth configuration — lazy init pattern
// ---------------------------------------------------------------------------
//
// Using `NextAuth((req) => config)` gives us access to the request object
// inside callbacks. This is required for the invite gate: the signIn callback
// must read the `pew-invite-code` cookie, which is only available on `req`.
//
// `req` is a NextRequest when called from route handlers / proxy, or
// undefined when called from Server Components (no request context).
// ---------------------------------------------------------------------------

const useSecureCookies = shouldUseSecureCookies();

export const { handlers, auth, signIn, signOut } = NextAuth((req) => ({
  // Trust the host header for automatic URL detection.
  // This allows the app to work behind reverse proxies (e.g. pew.dev.hexly.ai)
  // so Auth.js reads x-forwarded-host instead of using localhost.
  trustHost: true,
  adapter: D1AuthAdapter(getD1Client()),
  providers: [Google],
  session: {
    strategy: "jwt",
  },
  // Cookie configuration for reverse proxy environments
  cookies: {
    pkceCodeVerifier: {
      name: useSecureCookies
        ? "__Secure-authjs.pkce.code_verifier"
        : "authjs.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    state: {
      name: useSecureCookies ? "__Secure-authjs.state" : "authjs.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: useSecureCookies
        ? "__Secure-authjs.callback-url"
        : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    sessionToken: {
      name: useSecureCookies
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: useSecureCookies
        ? "__Host-authjs.csrf-token"
        : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  callbacks: {
    async signIn({ account, profile }) {
      // Gate new user registration behind invite codes.
      // Close over `req` to read the pew-invite-code cookie.
      // Pass profile.email so the pending placeholder is human-readable.
      return handleInviteGate(
        req,
        account
          ? {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              email: profile?.email ?? null,
            }
          : null
      );
    },
    jwt: jwtCallback,
    session: sessionCallback,
  },
  events: {
    async createUser({ user }: { user: User }) {
      // After adapter creates the user, backfill the real user ID
      // on the invite code (replacing the temporary 'pending:...' value).
      if (req) {
        const code = req.cookies.get("pew-invite-code")?.value;
        if (code && user.id) {
          try {
            await getD1Client().execute(
              "UPDATE invite_codes SET used_by = ? WHERE code = ? AND used_by LIKE 'pending:%'",
              [user.id, code]
            );
          } catch {
            // Best-effort backfill — code is already consumed, admin sees
            // pending:<providerAccountId> instead of UUID. Not critical.
          }
        }
      }
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
}));
