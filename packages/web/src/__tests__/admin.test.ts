import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isAdmin, resolveAdmin, isAdminUser } from "@/lib/admin";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
  E2E_TEST_USER_ID: "e2e-test-user-id",
  E2E_TEST_USER_EMAIL: "e2e@test.local",
}));

const { resolveUser } = await loadMockedAuthHelpers();

const { getDbRead } = (await import("@/lib/db")) as unknown as {
  getDbRead: ReturnType<typeof vi.fn>;
};

import { createMockDbRead, loadMockedAuthHelpers } from "./test-utils";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isAdmin", () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should return false for null/undefined email", () => {
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: "admin@example.com" };
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it("should return true for matching email (case insensitive)", () => {
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: "Admin@Example.com" };
    expect(isAdmin("admin@example.com")).toBe(true);
    expect(isAdmin("ADMIN@EXAMPLE.COM")).toBe(true);
  });

  it("should return false for non-admin email", () => {
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: "admin@example.com" };
    expect(isAdmin("user@example.com")).toBe(false);
  });

  it("should handle multiple comma-separated emails", () => {
    process.env = {
      ...ORIGINAL_ENV,
      ADMIN_EMAILS: "a@test.com, b@test.com , c@test.com",
    };
    expect(isAdmin("a@test.com")).toBe(true);
    expect(isAdmin("b@test.com")).toBe(true);
    expect(isAdmin("c@test.com")).toBe(true);
    expect(isAdmin("d@test.com")).toBe(false);
  });

  it("should return false when ADMIN_EMAILS is empty or unset", () => {
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: "" };
    expect(isAdmin("anyone@example.com")).toBe(false);

    process.env = { ...ORIGINAL_ENV };
    delete process.env.ADMIN_EMAILS;
    expect(isAdmin("anyone@example.com")).toBe(false);
  });

  it("should ignore blank entries from trailing commas", () => {
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: "a@test.com,,," };
    expect(isAdmin("a@test.com")).toBe(true);
    expect(isAdmin("")).toBe(false);
  });
});

describe("resolveAdmin", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead);
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: "admin@example.com" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should return null when not authenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const result = await resolveAdmin(new Request("http://localhost"));
    expect(result).toBeNull();
  });

  it("should return null when authenticated but not admin", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "user@example.com",
    });

    const result = await resolveAdmin(new Request("http://localhost"));
    expect(result).toBeNull();
  });

  it("should return admin result when email matches directly", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: "admin@example.com",
    });

    const result = await resolveAdmin(new Request("http://localhost"));
    expect(result).toEqual({ userId: "u1", email: "admin@example.com" });
  });

  it("should fall back to DB lookup when auth result has no email", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: undefined,
    });
    mockDbRead.getUserEmail.mockResolvedValueOnce("admin@example.com");

    const result = await resolveAdmin(new Request("http://localhost"));

    expect(mockDbRead.getUserEmail).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ userId: "u1", email: "admin@example.com" });
  });

  it("should return null when DB lookup finds no email", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: undefined,
    });
    mockDbRead.getUserEmail.mockResolvedValueOnce(null);

    const result = await resolveAdmin(new Request("http://localhost"));
    expect(result).toBeNull();
  });

  it("should return null when DB lookup returns non-admin email", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({
      userId: "u1",
      email: undefined,
    });
    mockDbRead.getUserEmail.mockResolvedValueOnce("user@example.com");

    const result = await resolveAdmin(new Request("http://localhost"));
    expect(result).toBeNull();
  });
});

describe("resolveAdmin — E2E admin bypass", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      E2E_SKIP_AUTH: "true",
      NODE_ENV: "development",
      E2E_ADMIN_BYPASS: "true",
    };
    delete process.env.RAILWAY_ENVIRONMENT;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should return synthetic admin user in E2E bypass mode", async () => {
    const result = await resolveAdmin(new Request("http://localhost"));
    expect(result).toEqual({
      userId: "e2e-test-user-id",
      email: "e2e@test.local",
    });
    expect(resolveUser).not.toHaveBeenCalled();
  });
});

describe("isAdmin — E2E admin bypass", () => {
  const ORIGINAL_ENV = process.env;

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should return true for any email when E2E admin bypass is active", () => {
    process.env = {
      ...ORIGINAL_ENV,
      E2E_SKIP_AUTH: "true",
      NODE_ENV: "development",
      E2E_ADMIN_BYPASS: "true",
      ADMIN_EMAILS: "",
    };
    delete process.env.RAILWAY_ENVIRONMENT;
    expect(isAdmin("random@nobody.com")).toBe(true);
  });
});

describe("isAdminUser — E2E admin bypass", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...ORIGINAL_ENV,
      E2E_SKIP_AUTH: "true",
      NODE_ENV: "development",
      E2E_ADMIN_BYPASS: "true",
    };
    delete process.env.RAILWAY_ENVIRONMENT;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should return true for any user when E2E admin bypass is active", async () => {
    const result = await isAdminUser({ userId: "u1", email: "nobody@test.com" });
    expect(result).toBe(true);
  });
});

describe("isAdminUser", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead);
    process.env = { ...ORIGINAL_ENV, ADMIN_EMAILS: "admin@example.com" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should return true when email is admin", async () => {
    const result = await isAdminUser({
      userId: "u1",
      email: "admin@example.com",
    });
    expect(result).toBe(true);
  });

  it("should return false when email is not admin", async () => {
    const result = await isAdminUser({
      userId: "u1",
      email: "user@example.com",
    });
    expect(result).toBe(false);
  });

  it("should fall back to DB lookup when auth result has no email", async () => {
    mockDbRead.getUserEmail.mockResolvedValueOnce("admin@example.com");

    const result = await isAdminUser({
      userId: "u1",
      email: undefined,
    });

    expect(mockDbRead.getUserEmail).toHaveBeenCalledWith("u1");
    expect(result).toBe(true);
  });

  it("should return false when DB lookup finds no email", async () => {
    mockDbRead.getUserEmail.mockResolvedValueOnce(null);

    const result = await isAdminUser({
      userId: "u1",
      email: undefined,
    });

    expect(result).toBe(false);
  });

  it("should return false when DB lookup returns non-admin email", async () => {
    mockDbRead.getUserEmail.mockResolvedValueOnce("user@example.com");

    const result = await isAdminUser({
      userId: "u1",
      email: undefined,
    });

    expect(result).toBe(false);
  });
});
