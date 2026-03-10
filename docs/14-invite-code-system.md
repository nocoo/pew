# Invite Code System

> Gate new user registration behind single-use invite codes managed by admins.
> Existing users are unaffected — the gate only applies to first-time sign-ups.

## Status

| # | Commit | Description | Status |
|---|--------|-------------|--------|
| 1 | `docs: add invite code system plan` | This document | |
| 2 | `feat: add invite_codes migration script` | `004-invite-codes.sql` | |
| 3 | `feat: add admin invites CRUD API` | `GET/POST/DELETE /api/admin/invites` | |
| 4 | `feat: add invite verification endpoint` | `POST /api/auth/verify-invite` | |
| 5 | `feat: gate new user registration with invite code` | `auth.ts` signIn callback + adapter | |
| 6 | `feat: add admin invite codes management page` | `/admin/invites` page + navigation | |
| 7 | `feat: add invite code input to login page` | Login page InviteRequired flow | |
| 8 | `test: add L1 unit tests for invite code system` | Pure logic + API route tests | |

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
  used_by    TEXT    REFERENCES users(id),  -- NULL = unused
  used_at    TEXT,                          -- ISO 8601 timestamp
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invite_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_used_by ON invite_codes(used_by);
```

- `used_by IS NULL` → code is available.
- `used_by IS NOT NULL` → code has been consumed (one-time use).
- `created_by` tracks which admin generated the code.

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
                          Google OAuth
                                 │
                          ┌──────▼──────┐
                          │  Auth.js    │
                          │  signIn     │
                          │  callback   │
                          └──────┬──────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
             getUserByAccount           getUserByAccount
             found (existing)           NOT found (new user)
                    │                         │
                    ▼                         ▼
               return true            Read cookie
               (allow login)          `pew-invite-code`
                                             │
                                  ┌──────────┴──────────┐
                                  │                      │
                             cookie exists           no cookie
                             code valid in DB        or invalid code
                                  │                      │
                                  ▼                      ▼
                             return true            return redirect
                             (allow,                "/login?error=
                              createUser              InviteRequired"
                              consumes code)
                                                         │
                                                         ▼
                                                  ┌──────────────┐
                                                  │  /login      │
                                                  │  shows invite│
                                                  │  code input  │
                                                  └──────┬───────┘
                                                         │
                                                  User enters code
                                                         │
                                                  POST /api/auth/
                                                    verify-invite
                                                         │
                                                  Set cookie +
                                                  retry Google OAuth
```

### Cookie Mechanism

When a user verifies their invite code via `POST /api/auth/verify-invite`:

1. Server validates the code exists and `used_by IS NULL`.
2. Server responds with `Set-Cookie: pew-invite-code=<CODE>; Path=/; HttpOnly;
   SameSite=Lax; Secure; Max-Age=600` (10-minute expiry).
3. Client receives 200 → triggers `signIn("google")`.
4. In the `signIn` callback, the server reads the cookie from the request.
5. After successful `createUser`, the invite code is consumed (UPDATE).
6. The cookie is cleared (Max-Age=0) in the response.

### Invite Code Consumption

The invite code is consumed in the Auth.js adapter's `createUser` method:

```ts
// After INSERT INTO users:
const inviteCode = cookies().get("pew-invite-code")?.value;
if (inviteCode) {
  await client.execute(
    "UPDATE invite_codes SET used_by = ?, used_at = datetime('now') WHERE code = ? AND used_by IS NULL",
    [userId, inviteCode]
  );
}
```

The `WHERE used_by IS NULL` guard prevents double-consumption even if two
requests arrive simultaneously with the same code.

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
      "used_by": null,
      "used_by_email": null,
      "used_at": null,
      "created_at": "2026-03-10T12:00:00Z"
    }
  ]
}
```

#### `POST /api/admin/invites`

Generate invite codes. Body: `{ "count": 5 }` (default 1, max 20).

```json
{
  "codes": ["A3K9X2M1", "B7F2H4N9", "C5D8K3P6", "E9G1M7R2", "F4J6N8T5"]
}
```

#### `DELETE /api/admin/invites?id=123`

Delete an unused invite code. Returns 409 if the code has already been used.

### Public Endpoint

#### `POST /api/auth/verify-invite`

Validate an invite code and set the cookie. Body: `{ "code": "A3K9X2M1" }`.

- 200: `{ "valid": true }` + Set-Cookie header.
- 400: `{ "valid": false, "error": "Invalid or already used" }`.

This route falls under `/api/auth/*` which is already public in `proxy.ts`.

---

## Frontend

### Admin Page: `/admin/invites`

Follows the established pattern from `/admin/pricing`:

- **Header**: Title "Invite Codes" + "Generate Codes" button.
- **Generate dialog**: Number input (1-20) in a collapsible card.
- **Table columns**: Code (monospace, with copy button) | Status (badge:
  `unused` green / `used` gray) | Used By (email) | Created At | Actions
  (delete button, only for unused codes).
- **Auth guard**: `useAdmin()` hook, redirect non-admins to `/`.

### Navigation Update

`navigation.ts` — append to `ADMIN_NAV_GROUP.items`:

```ts
{ href: "/admin/invites", label: "Invite Codes", icon: "Ticket" }
```

`sidebar.tsx` — add `Ticket` to the Lucide import and `ICON_MAP`.

### Login Page Update

When `?error=InviteRequired` is present in the URL:

1. Hide the default Google sign-in button.
2. Show an invite code input field with a "Verify & Sign In" button.
3. On submit → `POST /api/auth/verify-invite` with the code.
4. On success → automatically trigger `signIn("google")`.
5. On failure → show error message "Invalid or already used invite code".

The existing `AccessDenied` and generic error handling remain unchanged.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Existing user signs in normally | signIn callback finds user → allow, no invite check |
| New user without invite code | signIn callback rejects → redirect to `/login?error=InviteRequired` |
| New user with valid invite code | signIn callback allows → createUser consumes code |
| Same invite code used twice concurrently | `WHERE used_by IS NULL` ensures only one succeeds |
| Admin deletes a used invite code | API returns 409 Conflict, only unused codes deletable |
| Invite code cookie expires (10 min) | User must re-verify the code |
| E2E test mode (`E2E_SKIP_AUTH=true`) | Skip invite check entirely (same as auth skip) |
| CLI auth (`/api/auth/cli`) | Only works for existing users (fetches api_key), no createUser → unaffected |

---

## File Change Inventory

| # | File | Op | Description |
|---|------|----|-------------|
| 1 | `docs/14-invite-code-system.md` | NEW | This plan document |
| 2 | `scripts/migrations/004-invite-codes.sql` | NEW | Database migration |
| 3 | `src/app/api/admin/invites/route.ts` | NEW | Admin CRUD API |
| 4 | `src/app/api/auth/verify-invite/route.ts` | NEW | Public invite verification |
| 5 | `src/auth.ts` | EDIT | Add signIn callback for invite gate |
| 6 | `src/lib/auth-adapter.ts` | EDIT | Consume invite code in createUser |
| 7 | `src/app/(dashboard)/admin/invites/page.tsx` | NEW | Admin management page |
| 8 | `src/app/login/page.tsx` | EDIT | Add InviteRequired error + invite input |
| 9 | `src/lib/navigation.ts` | EDIT | Add Invite Codes nav item |
| 10 | `src/components/layout/sidebar.tsx` | EDIT | Add Ticket icon import |

---

## Test Plan

### L1 — Unit Tests (Pure Logic, No I/O)

File: `src/__tests__/invite-codes.test.ts`

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `generateInviteCode` returns 8-char uppercase alphanumeric | Code format |
| 2 | `generateInviteCode` excludes ambiguous chars (0, O, 1, I, L) | Character set |
| 3 | 100 generated codes are all unique | Collision resistance |
| 4 | `validateInviteCode` accepts valid format | Input validation |
| 5 | `validateInviteCode` rejects empty / too short / lowercase | Input validation |

### L1 — API Route Tests (Mocked D1)

File: `src/__tests__/admin-invites-api.test.ts`

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `GET /api/admin/invites` returns 403 for non-admin | Auth guard |
| 2 | `GET /api/admin/invites` returns rows for admin | List functionality |
| 3 | `POST /api/admin/invites` generates N codes | Bulk generation |
| 4 | `POST /api/admin/invites` rejects count > 20 | Input validation |
| 5 | `POST /api/admin/invites` rejects count < 1 | Input validation |
| 6 | `DELETE /api/admin/invites?id=X` deletes unused code | Delete happy path |
| 7 | `DELETE /api/admin/invites?id=X` returns 409 for used code | Delete guard |
| 8 | `DELETE /api/admin/invites` returns 400 without id | Input validation |

File: `src/__tests__/verify-invite-api.test.ts`

| # | Test | What it validates |
|---|------|-------------------|
| 1 | `POST /api/auth/verify-invite` returns valid=true for unused code | Happy path |
| 2 | `POST /api/auth/verify-invite` sets cookie in response | Cookie mechanism |
| 3 | `POST /api/auth/verify-invite` returns valid=false for used code | Used code rejection |
| 4 | `POST /api/auth/verify-invite` returns valid=false for nonexistent code | Invalid code |
| 5 | `POST /api/auth/verify-invite` returns 400 for missing body | Input validation |

### L1 — Auth Callback Tests

File: `src/__tests__/auth-invite-gate.test.ts`

| # | Test | What it validates |
|---|------|-------------------|
| 1 | signIn callback allows existing user (no invite check) | Existing user bypass |
| 2 | signIn callback rejects new user without invite cookie | Gate enforcement |
| 3 | signIn callback allows new user with valid invite cookie | Gate pass-through |
| 4 | signIn callback rejects new user with used invite cookie | Used code rejection |
| 5 | createUser consumes invite code after INSERT | Code consumption |
| 6 | createUser with no invite cookie still creates user (E2E mode) | Test mode bypass |

### L1 — Navigation Tests

File: `src/__tests__/navigation.test.ts` (extend existing)

| # | Test | What it validates |
|---|------|-------------------|
| 1 | Admin nav group includes "Invite Codes" item | Navigation config |
| 2 | Breadcrumbs for `/admin/invites` are correct | Breadcrumb generation |

---

## Atomic Commit Plan

Each commit is independently buildable and testable. Ordered by dependency:

| # | Type | Message | Files | Depends On |
|---|------|---------|-------|------------|
| 1 | docs | `docs: add invite code system plan` | `docs/14-invite-code-system.md` | — |
| 2 | feat | `feat: add invite_codes migration script` | `scripts/migrations/004-invite-codes.sql` | — |
| 3 | feat | `feat: add admin invites CRUD API` | `src/app/api/admin/invites/route.ts`, `src/lib/invite.ts` (shared helpers) | #2 |
| 4 | feat | `feat: add invite verification endpoint` | `src/app/api/auth/verify-invite/route.ts` | #2, #3 |
| 5 | feat | `feat: gate new user registration with invite code` | `src/auth.ts`, `src/lib/auth-adapter.ts` | #2, #4 |
| 6 | feat | `feat: add admin invite codes management page` | `src/app/(dashboard)/admin/invites/page.tsx`, `src/lib/navigation.ts`, `src/components/layout/sidebar.tsx` | #3 |
| 7 | feat | `feat: add invite code input to login page` | `src/app/login/page.tsx` | #4, #5 |
| 8 | test | `test: add L1 unit tests for invite code system` | `src/__tests__/invite-codes.test.ts`, `src/__tests__/admin-invites-api.test.ts`, `src/__tests__/verify-invite-api.test.ts`, `src/__tests__/auth-invite-gate.test.ts`, `src/__tests__/navigation.test.ts` | #3, #4, #5, #6, #7 |

### Commit Dependency Graph

```
#1 (docs) ─────────────────────────────────────────────┐
#2 (migration) ────┬───────────────────────────────────┤
                   │                                    │
#3 (admin API) ────┼──────────┬────────────────────────┤
                   │          │                         │
#4 (verify API) ───┤          │                         │
                   │          │                         │
#5 (auth gate) ────┤          │                         │
                   │          │                         │
                   │   #6 (admin page + nav) ──────────┤
                   │                                    │
                   └── #7 (login page) ────────────────┤
                                                        │
                                              #8 (tests) ┘
```
