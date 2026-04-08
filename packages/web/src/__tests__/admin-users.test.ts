/**
 * Tests for GET /api/admin/users
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/users/route";

// Mock admin resolver
vi.mock("@/lib/admin", () => ({
  resolveAdmin: vi.fn(),
}));

// Mock database
vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

import { resolveAdmin } from "@/lib/admin";
import { getDbRead } from "@/lib/db";

describe("GET /api/admin/users", () => {
  const mockQuery = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDbRead).mockResolvedValue({
      query: mockQuery,
    } as never);
  });

  it("should return 403 for non-admin users", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue(null);

    const request = new Request("http://localhost/api/admin/users?q=test");
    const response = await GET(request);

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Forbidden");
  });

  it("should return empty array for empty query", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });

    const request = new Request("http://localhost/api/admin/users?q=");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.users).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("should return empty array for missing query param", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });

    const request = new Request("http://localhost/api/admin/users");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.users).toEqual([]);
  });

  it("should return empty array for whitespace-only query", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });

    const request = new Request("http://localhost/api/admin/users?q=%20%20");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.users).toEqual([]);
  });

  it("should search users by name or email", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });

    const mockUsers = [
      { id: "u1", name: "Alice", email: "alice@example.com", image: null },
      { id: "u2", name: "Bob", email: "bob@example.com", image: "http://img.com/bob.png" },
    ];
    mockQuery.mockResolvedValue({ results: mockUsers });

    const request = new Request("http://localhost/api/admin/users?q=example");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.users).toEqual(mockUsers);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE name LIKE"),
      ["%example%", "%example%", 20],
    );
  });

  it("should respect custom limit parameter", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });
    mockQuery.mockResolvedValue({ results: [] });

    const request = new Request("http://localhost/api/admin/users?q=test&limit=10");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ["%test%", "%test%", 10],
    );
  });

  it("should cap limit at 50", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });
    mockQuery.mockResolvedValue({ results: [] });

    const request = new Request("http://localhost/api/admin/users?q=test&limit=100");
    const response = await GET(request);

    expect(response.status).toBe(200);
    // Limit should remain at default 20 since 100 > 50
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ["%test%", "%test%", 20],
    );
  });

  it("should ignore invalid limit values", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });
    mockQuery.mockResolvedValue({ results: [] });

    const request = new Request("http://localhost/api/admin/users?q=test&limit=abc");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ["%test%", "%test%", 20],
    );
  });

  it("should ignore negative limit values", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });
    mockQuery.mockResolvedValue({ results: [] });

    const request = new Request("http://localhost/api/admin/users?q=test&limit=-5");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ["%test%", "%test%", 20],
    );
  });

  it("should return 500 on database error", async () => {
    vi.mocked(resolveAdmin).mockResolvedValue({
      userId: "admin-1",
      email: "admin@example.com",
    });
    mockQuery.mockRejectedValue(new Error("DB connection failed"));

    const request = new Request("http://localhost/api/admin/users?q=test");
    const response = await GET(request);

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("Failed to search users");
  });
});
