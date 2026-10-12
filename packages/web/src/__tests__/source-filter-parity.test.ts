import { describe, it, expect, vi, beforeEach } from "vitest";
import { SOURCES, VALID_SOURCES } from "@pew/core";
import { GET as usageGET } from "@/app/api/usage/route";
import { GET as sessionsGET } from "@/app/api/sessions/route";
import { GET as leaderboardGET } from "@/app/api/leaderboard/route";
import { GET as usersGET } from "@/app/api/users/[slug]/route";
import * as dbModule from "@/lib/db";
import { resolveUser } from "@/lib/auth-helpers";
import { isAdmin, isAdminUser } from "@/lib/admin";
import { createMockDbRead } from "./test-utils";

vi.mock("@/lib/db", () => ({ getDbRead: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn() }));
vi.mock("@/lib/admin", () => ({ isAdmin: vi.fn(), isAdminUser: vi.fn() }));

/**
 * Every `?source=` route must validate against the SAME core set. Each route
 * previously carried its own 15-source literal copy, so a source added to core
 * could silently miss a route. These tests fail if a route's accepted set
 * diverges from core's `VALID_SOURCES`.
 */

const routes: Array<{ name: string; get: (req: Request) => Promise<Response> }> = [
  { name: "/api/usage", get: usageGET },
  { name: "/api/sessions", get: sessionsGET },
  { name: "/api/leaderboard", get: leaderboardGET },
  { name: "/api/users/[slug]", get: (req: Request) => usersGET(req, ctx()) },
];

function requestFor(source: string): Request {
  const url = new URL("http://localhost:7020/api/x");
  url.searchParams.set("source", source);
  return new Request(url.toString());
}

function ctx(slug = "alice"): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

describe("?source= routes share core VALID_SOURCES", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const db = createMockDbRead();
    // The users route resolves the profile BEFORE the source gate, so it needs
    // a public user to reach the allowlist check at all.
    db.getPublicUserBySlugOrId.mockResolvedValue({
      id: "u1",
      is_public: true,
    } as never);
    vi.mocked(dbModule.getDbRead).mockResolvedValue(db as never);
    vi.mocked(resolveUser).mockResolvedValue({ userId: "u1" } as never);
    vi.mocked(isAdmin).mockResolvedValue(false);
    vi.mocked(isAdminUser).mockResolvedValue(false);
  });

  it("core VALID_SOURCES is a superset of SOURCES (retired identities stay readable)", () => {
    for (const source of SOURCES) {
      expect(VALID_SOURCES.has(source), `${source} missing from VALID_SOURCES`).toBe(true);
    }
  });

  for (const { name, get } of routes) {
    it(`${name} accepts every core source and rejects a non-core one`, async () => {
      for (const source of VALID_SOURCES) {
        const res = await get(requestFor(source));
        // A valid source must clear the 400 allowlist gate. Downstream status
        // (200/500 from the mocked DB) is irrelevant — only the gate is pinned.
        expect(res.status, `${name} rejected ${source}`).not.toBe(400);
      }
      const bogus = await get(requestFor("not-a-real-source"));
      expect(bogus.status, `${name} accepted a non-core source`).toBe(400);
    });
  }
});
