# Invite Code System

> Gate new user registration behind single-use invite codes managed by admins.
> Existing users are unaffected — the gate only applies to first-time sign-ups.

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add invite code system plan` | This document | ✅ done |
| 2 | `feat: add invite_codes migration script` | `004-invite-codes.sql` | |
| 3 | `feat: add invite code shared helpers` | `packages/web/src/lib/invite.ts` | |
| 4 | `feat: add admin invites CRUD API` | `GET/POST/DELETE /api/admin/invites` | |
| 5 | `feat: add invite verification endpoint` | `POST /api/auth/verify-invite` | |
| 6 | `feat: gate new user registration with invite code` | `auth.ts` lazy init + signIn callback | |
| 7 | `feat: add admin invite codes management page` | `/admin/invites` page + navigation | |
| 8 | `feat: add invite code input to login page` | Login page InviteRequired flow | |
| 9 | `test: add L1 unit tests for invite code system` | Pure logic + API route tests | |

---

## Problem

The app currently has **fully open registration** — anyone with a Google account
can sign in and a user record is automatically created via the Auth.js adapter.
There is no mechanism to restrict who can create an account.

We need a **closed-beta / invite-only** registration model where:

- Admins generate single-use invite codes from a dashboard page.
- New users must provide a valid invite code to complete their first sign-in.
- Existing users (already in the `users` table) continue to sign in normally
  with zero friction.
- Each invite code can only be used once.

---

## Design

### Database Schema

New table `invite_codes` in D1 (migration `004-invite-codes.sql`):

```sql
CREATE TABLE IF NOT EXISTS invite_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,       -- 8-char uppercase alphanumeric
  created_by TEXT    NOT NULL REFERENCES users(id),
  used_by    TEXT,                          -- NULL = unused, user ID or 'pending:<email>'
  used_at    TEXT,                          -- ISO 8601 timestamp
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invite_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_used_by ON invite_codes(used_by);
```

- `used_by IS NULL` → code is available.
- `used_by IS NOT NULL` → code has been consumed (one-time use).
- `created_by` tracks which admin generated the code.

**Why `used_by` has no foreign key constraint:** The `signIn` callback must
consume the invite code BEFORE `createUser` runs (the user doesn't exist yet).
We write `'pending:<email>'` as a temporary value, then backfill the real user
ID in `events.createUser`. A `REFERENCES users(id)` FK would reject the
`pending:` prefix since no matching user row exists. Plain `TEXT` is the
pragmatic choice — the admin page displays either format, and the backfill
converts most entries to real user IDs anyway.

### Code Format

8-character uppercase alphanumeric string (e.g. `A3K9X2M1`), generated from
`crypto.getRandomValues()`. Excludes ambiguous characters (`0/O`, `1/I/L`)
for readability: alphabet is `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.

---

### Registration Flow (Two-Step)

The key design decision is a **two-step flow** that keeps existing users
friction-free while gating new registrations:

```
                          ┌─────────────┐
                          │  /login     │
                          │  (Google    │
                          │   button)   │
                          └──────┬──────┘
                                 │
                     signIn("google",
                       { callbackUrl })
                                 │
                          Google OAuth
                                 │
                          ┌──────▼──────┐
                          │  Auth.js    │
                          │  signIn     │
                          │  callback   │
                          │  (via lazy  │
                          │   init req) │
                          └──────┬──────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
          getUserByAccount             getUserByAccount
          found (existing user)        NOT found (new user)
                    │                         │
                    ▼                         ▼
               return true            Read cookie
               (allow login)          `pew-invite-code`
                                      from req via closure
                                             │
                                  ┌──────────┴──────────┐
                                  │                      │
                             cookie exists           no cookie
                             + atomic UPDATE         or invalid code
                             succeeds (changes=1)         │
                                  │                       ▼
                                  ▼                  return redirect
                             return true             "/login?error=
                             (code consumed,           InviteRequired
                              createUser                &callbackUrl=..."
                              proceeds)
                                                          │
                                                          ▼
                                                   ┌──────────────┐
                                                   │  /login      │
                                                   │  shows invite│
                                                   │  code input  │
                                                   │  (preserves  │
                                                   │  callbackUrl)│
                                                   └──────┬───────┘
                                                          │
                                                   User enters code
                                                          │
                                                   POST /api/auth/
                                                     verify-invite
                                                          │
                                                   Set cookie +
                                                   re-trigger
                                                   signIn("google",
                                                     { callbackUrl })
```

---

### Auth.js Integration: Lazy Init + signIn Callback

**This is the core architectural decision.** The Auth.js v5 `signIn` callback
receives only `{ user, account, profile }` — it does NOT receive the request
object, cookies, or `isNewUser` flag. However, `NextAuth()` supports a **lazy
initializer** pattern that receives the request:

```ts
// packages/web/src/auth.ts — new pattern
export const { handlers, auth, signIn, signOut } = NextAuth((req) => {
  // req: NextRequest | undefined
  // undefined when called from Server Components (no request context)
  // NextRequest when called from route handlers, middleware, proxy
  return {
    providers: [Google],
    adapter: D1AuthAdapter(getD1Client()),
    callbacks: {
      async signIn({ user, account }) {
        // Close over `req` to read cookies
        return handleInviteGate(req, account);
      },
      jwt: jwtCallback,
      session: sessionCallback,
    },
    // ... rest of config
  };
});
```

The `handleInviteGate` function (in `packages/web/src/lib/invite.ts`):

1. Uses `account.provider` + `account.providerAccountId` to query
   `getUserByAccount` — if found, user exists → return `true`.
2. If not found → read `pew-invite-code` cookie from `req.cookies`.
3. If no cookie → return `"/login?error=InviteRequired&callbackUrl=..."`.
4. **Atomically consume** the invite code:
   ```sql
   UPDATE invite_codes
   SET used_by = 'pending:' || ?, used_at = datetime('now')
   WHERE code = ? AND used_by IS NULL
   ```
   The `used_by` is set to `'pending:<email>'` because the actual user ID
   doesn't exist yet (user hasn't been created). The `WHERE used_by IS NULL`
   clause makes this atomic — only one concurrent request can succeed.
5. If `changes === 0` → code was invalid or already used → return redirect URL.
6. If `changes === 1` → code consumed → return `true` (Auth.js proceeds to
   `createUser` → `linkAccount`).

**Post-creation fixup:** The `events.createUser` callback fires after the
adapter's `createUser()`. We use it to update the `pending:` placeholder
with the real user ID:

```ts
events: {
  async createUser({ user }) {
    // Backfill the real user ID on the invite code
    if (req) {
      const code = req.cookies.get("pew-invite-code")?.value;
      if (code && user.id) {
        await getD1Client().execute(
          "UPDATE invite_codes SET used_by = ? WHERE code = ? AND used_by LIKE 'pending:%'",
          [user.id, code]
        );
      }
    }
  },
},
```

**Why this is safe:**

- The invite code is atomically consumed (UPDATE with WHERE used_by IS NULL)
  BEFORE `createUser` runs — so no user can be created without a valid code.
- The `pending:` → real ID backfill is best-effort. If it fails, the code is
  still marked as used (just with email instead of UUID). The admin page can
  display either format.
- The adapter (`auth-adapter.ts`) stays completely unchanged — pure D1 layer.

### Cookie Mechanism

**Setting the cookie** — `POST /api/auth/verify-invite`:

1. Server validates the code exists and `used_by IS NULL` (read-only check,
   does NOT consume — consumption happens in signIn callback).
2. Server responds with `Set-Cookie` using the same secure/insecure rules as
   auth cookies:
   ```
   Set-Cookie: pew-invite-code=<CODE>;
     Path=/; HttpOnly; SameSite=Lax;
     Secure={shouldUseSecureCookies()};
     Max-Age=600
   ```
3. Client receives 200 → triggers `signIn("google", { callbackUrl })`.

The cookie uses `shouldUseSecureCookies()` from `auth.ts` (reused as a shared
export) to match the auth cookie security level. This ensures the cookie works
in both `https://pew.dev.hexly.ai` (Secure) and `http://localhost:7020`
(non-Secure).

**Cookie expiry:** 10 minutes (`Max-Age=600`). This is generous enough for the
OAuth round-trip but short enough to not linger. No explicit cleanup is needed —
the cookie naturally expires.

### callbackUrl Preservation

The current login page hardcodes `callbackUrl: "/"` in `signIn("google")`.
Several flows depend on `callbackUrl` being preserved:

- **CLI auth:** `/api/auth/cli` redirects to `/login?callbackUrl=/api/auth/cli?callback=...`
- **Direct page access:** Proxy redirects unauthenticated users to `/login`
  (currently loses the original URL, but `callbackUrl` support is needed for
  future correctness).

**Changes to login page (`packages/web/src/app/login/page.tsx`):**

```ts
const searchParams = useSearchParams();
const callbackUrl = searchParams.get("callbackUrl") ?? "/";

const handleGoogleLogin = () => {
  signIn("google", { callbackUrl });
};
```

**InviteRequired redirect URL** (from signIn callback) must also preserve it:

```ts
// In handleInviteGate:
// During the OAuth callback, req.nextUrl is /api/auth/callback/google?code=...
// The user's desired callbackUrl is stored in the Auth.js callback-url cookie,
// NOT in the URL search params. Read from the cookie, matching the configured
// cookie name (secure vs insecure prefix).
const callbackUrlCookieName = shouldUseSecureCookies()
  ? "__Secure-authjs.callback-url"
  : "authjs.callback-url";
const originalCallbackUrl = req?.cookies.get(callbackUrlCookieName)?.value ?? "/";
return `/login?error=InviteRequired&callbackUrl=${encodeURIComponent(originalCallbackUrl)}`;
```

**Why cookies, not URL params:** During the `/api/auth/callback/google` phase,
`req.nextUrl` is the OAuth callback URL (contains `code`, `state` params from
Google), NOT the original page. Auth.js stores the user's desired redirect
destination in its own `authjs.callback-url` cookie (or `__Secure-authjs.callback-url`
when secure cookies are enabled). We read from this cookie to preserve the
callbackUrl through the InviteRequired redirect.

**Note:** The signIn callback's redirect URL goes through Auth.js's
`callbacks.redirect`, which validates it's a same-origin URL. Since `/login?...`
is a relative path, this works without additional configuration.

---

## API Endpoints

### Admin Endpoints (require admin auth)

#### `GET /api/admin/invites`

Returns all invite codes with usage info.

```json
{
  "rows": [
    {
      "id": 1,
      "code": "A3K9X2M1",
      "created_by": "user-uuid",
      "created_by_email": "admin@example.com",
      "used_by": "other-uuid",
      "used_by_email": "invited@example.com",
      "used_at": "2026-03-10T14:00:00Z",
      "created_at": "2026-03-10T12:00:00Z"
    }
  ]
}
```

SQL joins `users` table twice (as `creator` and `consumer`) to resolve emails.

#### `POST /api/admin/invites`

Generate invite codes. Body: `{ "count": 5 }` (default 1, max 20).

```json
{
  "codes": ["A3K9X2M1", "B7F2H4N9", "C5D8K3P6", "E9G1M7R2", "F4J6N8T5"]
}
```

#### `DELETE /api/admin/invites?id=123`

Delete an unused or burned invite code. Deletable when `used_by IS NULL` (unused)
or `used_by LIKE 'pending:%'` (burned / reclaimable). Returns 409 if the code
has been fully consumed by a real user (non-pending `used_by`).

### Public Endpoint

#### `POST /api/auth/verify-invite`

Validate an invite code (read-only check) and set the cookie.
Body: `{ "code": "A3K9X2M1" }`.

- 200: `{ "valid": true }` + Set-Cookie header.
- 400: `{ "valid": false, "error": "Invalid or already used" }`.

This route falls under `/api/auth/*` which is already public in `proxy.ts`
(`isPublicRoute` at `packages/web/src/proxy.ts:26`). No proxy changes needed.

**Important:** This endpoint does NOT consume the code. It only verifies that
the code exists and is unused, then sets the cookie. Actual consumption happens
atomically in the `signIn` callback.

---

## Frontend

### Admin Page: `/admin/invites`

Follows the established pattern from `/admin/model-prices`:

- **Header**: Title "Invite Codes" + "Generate Codes" button.
- **Generate dialog**: Number input (1-20) in a collapsible card.
- **Table columns**: Code (monospace, with copy button) | Status (badge:
  `unused` green / `pending` amber / `used` gray) | Used By (email or
  `pending:<email>`) | Created At | Actions (delete button for unused codes,
  reclaim button for `pending:*` codes that may be burned).
- **Auth guard**: `useAdmin()` hook, redirect non-admins to `/`.

### Navigation Update

`packages/web/src/lib/navigation.ts` — append to `ADMIN_NAV_GROUP.items`:

```ts
{ href: "/admin/invites", label: "Invite Codes", icon: "Ticket" }
```

`packages/web/src/components/layout/sidebar.tsx` — add `Ticket` to the Lucide
import and `ICON_MAP`.

### Login Page Update

**`packages/web/src/app/login/page.tsx`** changes:

1. **Always read `callbackUrl`** from search params, default to `"/"`.
   Pass it to `signIn("google", { callbackUrl })`.

2. **When `?error=InviteRequired`** is present:
   - Show an invite code input field with a "Verify & Sign In" button.
   - On submit → `POST /api/auth/verify-invite` with the code.
   - On success (200) → automatically trigger `signIn("google", { callbackUrl })`
     (callbackUrl preserved from search params).
   - On failure → show error message "Invalid or already used invite code".

3. **When no error or other errors** → show the normal Google button (existing
   behavior). Existing `AccessDenied` and generic error handling unchanged.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Existing user signs in normally | signIn callback queries DB, user found → allow, no invite check |
| New user without invite code | signIn callback: no cookie → redirect `/login?error=InviteRequired&callbackUrl=...` |
| New user with valid invite code | signIn callback: atomic UPDATE consumes code → allow → createUser proceeds |
| Same invite code used concurrently | `WHERE used_by IS NULL` ensures only one UPDATE succeeds (changes=1 vs 0) |
| Admin deletes a used invite code | API returns 409 Conflict, only unused codes deletable |
| Invite code cookie expires (10 min) | User must re-verify the code via the input form |
| E2E test mode (`E2E_SKIP_AUTH=true`) | signIn callback skips invite check (same as auth skip) |
| CLI auth (`/api/auth/cli`) | Uses `resolveUser()` for existing users only → no createUser → unaffected |
| `req` is undefined (Server Component) | signIn callback treats as existing-user path (safe: Server Components don't trigger OAuth) |
| `http://localhost` dev environment | Cookie uses `SameSite=Lax; Secure=false` via `shouldUseSecureCookies()` |
| Redirect after InviteRequired | `callbackUrl` preserved in search params through entire flow |
| `events.createUser` backfill fails | Code still consumed (has `pending:<email>`), admin sees email instead of UUID |
| `createUser` / `linkAccount` fails after invite consumed | Code is "burned" with `pending:<email>` status but no user created. Admin can reclaim — see Compensation Strategy below |

### Compensation Strategy: Burned Invite Codes

If the `signIn` callback consumes an invite code (atomic UPDATE succeeds) but
the subsequent `createUser` or `linkAccount` call fails (e.g. D1 outage, unique
constraint violation), the code is "burned" — marked as used with
`pending:<email>` but no user was actually created.

**Detection:** Admin page shows codes where `used_by LIKE 'pending:%'`. These
are either (a) legitimate new users whose backfill hasn't run yet, or (b) burned
codes from failed registrations. To distinguish: if `used_at` is older than
10 minutes and no user exists with that email, the code is burned.

**Reclaim action:** The admin `DELETE /api/admin/invites?id=X` endpoint is
enhanced to allow deleting codes in `pending:*` state (not just `used_by IS NULL`).
Specifically:
- `used_by IS NULL` → deletable (unused)
- `used_by LIKE 'pending:%'` → deletable (reclaim burned code)
- `used_by` is a real user ID → returns 409 Conflict (legitimately used)

This avoids over-engineering an automatic retry/rollback mechanism for an
extremely rare failure case (D1 must fail between the UPDATE and createUser,
within a single request). The admin has full visibility and manual control.

---

## File Change Inventory

All paths relative to `packages/web/`:

| # | File | Op | Description |
|---|------|----|-------------|
| 1 | `docs/12-invite-code-system.md` | NEW | This plan document |
| 2 | `scripts/migrations/004-invite-codes.sql` | NEW | Database migration |
| 3 | `packages/web/src/lib/invite.ts` | NEW | Shared helpers: `generateInviteCode`, `validateInviteCode`, `handleInviteGate` |
| 4 | `packages/web/src/app/api/admin/invites/route.ts` | NEW | Admin CRUD API |
| 5 | `packages/web/src/app/api/auth/verify-invite/route.ts` | NEW | Public invite verification + set cookie |
| 6 | `packages/web/src/auth.ts` | EDIT | Refactor to lazy init `NextAuth((req) => ...)`, add signIn callback + createUser event |
| 7 | `packages/web/src/app/(dashboard)/admin/invites/page.tsx` | NEW | Admin management page |
| 8 | `packages/web/src/app/login/page.tsx` | EDIT | Add callbackUrl preservation + InviteRequired error + invite input |
| 9 | `packages/web/src/lib/navigation.ts` | EDIT | Add Invite Codes nav item |
| 10 | `packages/web/src/components/layout/sidebar.tsx` | EDIT | Add Ticket icon import |

**Files NOT changed:**

| File | Reason |
|------|--------|
| `packages/web/src/lib/auth-adapter.ts` | Adapter stays pure D1 layer — invite logic lives in signIn callback |
| `packages/web/src/proxy.ts` | `/api/auth/verify-invite` already covered by `isPublicRoute` prefix match |

---

## Test Plan

### L1 — Unit Tests (Pure Logic, No I/O)

File: `packages/web/src/__tests__/invite-codes.test.ts`

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `generateInviteCode` returns 8-char uppercase alphanumeric | Code format |
| 2 | `generateInviteCode` excludes ambiguous chars (0, O, 1, I, L) | Character set |
| 3 | 100 generated codes are all unique | Collision resistance |
| 4 | `validateInviteCode` accepts valid format | Input validation |
| 5 | `validateInviteCode` rejects empty / too short / lowercase | Input validation |

### L1 — API Route Tests (Mocked D1)

File: `packages/web/src/__tests__/admin-invites-api.test.ts`

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `GET /api/admin/invites` returns 403 for non-admin | Auth guard |
| 2 | `GET /api/admin/invites` returns rows for admin | List functionality |
| 3 | `POST /api/admin/invites` generates N codes | Bulk generation |
| 4 | `POST /api/admin/invites` rejects count > 20 | Input validation |
| 5 | `POST /api/admin/invites` rejects count < 1 | Input validation |
| 6 | `DELETE /api/admin/invites?id=X` deletes unused code | Delete happy path |
| 7 | `DELETE /api/admin/invites?id=X` deletes burned `pending:*` code | Reclaim burned code |
| 8 | `DELETE /api/admin/invites?id=X` returns 409 for fully used code | Delete guard |
| 9 | `DELETE /api/admin/invites` returns 400 without id | Input validation |

File: `packages/web/src/__tests__/verify-invite-api.test.ts`

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `POST /api/auth/verify-invite` returns valid=true for unused code | Happy path |
| 2 | `POST /api/auth/verify-invite` sets cookie in response | Cookie mechanism |
| 3 | `POST /api/auth/verify-invite` cookie respects shouldUseSecureCookies() | Env-aware security |
| 4 | `POST /api/auth/verify-invite` returns valid=false for used code | Used code rejection |
| 5 | `POST /api/auth/verify-invite` returns valid=false for nonexistent code | Invalid code |
| 6 | `POST /api/auth/verify-invite` returns 400 for missing body | Input validation |

### L1 — signIn Callback Tests

File: `packages/web/src/__tests__/auth-invite-gate.test.ts`

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `handleInviteGate` allows existing user (no invite check) | Existing user bypass |
| 2 | `handleInviteGate` rejects new user without invite cookie | Gate enforcement |
| 3 | `handleInviteGate` rejects new user with expired/missing cookie | Cookie absence |
| 4 | `handleInviteGate` allows new user with valid invite cookie | Gate pass-through |
| 5 | `handleInviteGate` rejects new user with already-used invite code | Atomic guard |
| 6 | `handleInviteGate` redirect URL preserves callbackUrl | callbackUrl preservation |
| 7 | `handleInviteGate` skips check when E2E_SKIP_AUTH=true | Test mode bypass |
| 8 | `handleInviteGate` handles req=undefined gracefully | Server Component safety |

### L1 — Navigation Tests

File: `packages/web/src/__tests__/navigation.test.ts` (extend existing)

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Admin nav group includes "Invite Codes" item | Navigation config |
| 2 | Breadcrumbs for `/admin/invites` are correct | Breadcrumb generation |

---

## Atomic Commit Plan

Each commit is independently buildable and testable. Ordered by dependency:

| # | Type | Message | Files | Depends On |
|---|------|---------|-------|------------|
| 1 | docs | `docs: add invite code system plan` | `docs/12-invite-code-system.md` | — |
| 2 | feat | `feat: add invite_codes migration script` | `scripts/migrations/004-invite-codes.sql` | — |
| 3 | feat | `feat: add invite code shared helpers` | `packages/web/src/lib/invite.ts` | — |
| 4 | feat | `feat: add admin invites CRUD API` | `packages/web/src/app/api/admin/invites/route.ts` | #2, #3 |
| 5 | feat | `feat: add invite verification endpoint` | `packages/web/src/app/api/auth/verify-invite/route.ts` | #3 |
| 6 | feat | `feat: gate new user registration with invite code` | `packages/web/src/auth.ts` | #3 |
| 7 | feat | `feat: add admin invite codes management page` | `packages/web/src/app/(dashboard)/admin/invites/page.tsx`, `packages/web/src/lib/navigation.ts`, `packages/web/src/components/layout/sidebar.tsx` | #4 |
| 8 | feat | `feat: add invite code input to login page` | `packages/web/src/app/login/page.tsx` | #5, #6 |
| 9 | test | `test: add L1 unit tests for invite code system` | `packages/web/src/__tests__/invite-codes.test.ts`, `packages/web/src/__tests__/admin-invites-api.test.ts`, `packages/web/src/__tests__/verify-invite-api.test.ts`, `packages/web/src/__tests__/auth-invite-gate.test.ts`, `packages/web/src/__tests__/navigation.test.ts` | #3–#8 |

### Commit Dependency Graph

```
#1 (docs) ──────────────────────────────────────────────────┐
#2 (migration) ─────┬──────────────────────────────────────┤
                     │                                      │
#3 (lib/invite.ts) ──┼──────┬────────┬─────────────────────┤
                     │      │        │                      │
               #4 (admin API)  #5 (verify API)  #6 (auth gate)
                     │      │        │                      │
               #7 (admin page + nav) │                      │
                            │        │                      │
                            └── #8 (login page) ───────────┤
                                                            │
                                                  #9 (tests) ┘
```

---

## Technical Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `NextAuth((req) => ...)` lazy init breaks existing auth | High | Preserve all existing config; only add signIn callback + createUser event. Verify with full E2E test. |
| `req` is undefined in some contexts | Medium | `handleInviteGate` treats `req=undefined` as "allow" — safe because OAuth callbacks always have a request context. |
| Cookie not sent during OAuth callback | Medium | Cookie uses `SameSite=Lax` which allows top-level navigations (OAuth redirects are top-level). `Path=/` ensures it's sent to all routes. |
| `signIn` callback can't distinguish new vs existing user | Low | We query `getUserByAccount` ourselves inside the callback — same query the adapter uses. Slight duplication but necessary. |
| `events.createUser` backfill fails | Low | Code is already consumed in signIn callback. Backfill is best-effort for admin display. |
| `createUser`/`linkAccount` fails after invite consumed | Low | Code is "burned" with `pending:` prefix. Admin can detect and reclaim via enhanced DELETE endpoint. See Compensation Strategy in Edge Cases. Extremely rare — requires D1 failure between UPDATE and createUser within one request. |
