import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useMemo: (factory: () => unknown) => factory(),
    useCallback: <T extends (...args: any[]) => any>(fn: T) => fn,
  };
});

vi.mock("@/hooks/use-user-profile", () => ({
  useUserProfile: vi.fn(),
}));

vi.mock("@/hooks/use-usage-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-usage-data")>();
  return {
    ...actual,
    useUsageData: vi.fn(),
  };
});

vi.mock("@/hooks/use-pricing", () => ({
  usePricingMap: vi.fn(),
  formatCost: (v: number) => `$${v.toFixed(2)}`,
}));

import { useProfileCompare } from "@/hooks/use-profile-compare";
import { useUserProfile } from "@/hooks/use-user-profile";
import { useUsageData } from "@/hooks/use-usage-data";
import { usePricingMap } from "@/hooks/use-pricing";

const mockedUseUserProfile = vi.mocked(useUserProfile);
const mockedUseUsageData = vi.mocked(useUsageData);
const mockedUsePricingMap = vi.mocked(usePricingMap);

describe("useProfileCompare", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockedUsePricingMap.mockReturnValue({
      pricingMap: {
        models: {
          "gpt-4o": { input: 2, output: 8, cached: 0.5 },
          "claude-sonnet-4-20250514": { input: 3, output: 15, cached: 0.3 },
        },
        prefixes: [],
        sourceDefaults: {},
        fallback: { input: 0, output: 0, cached: 0 },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("normalizes shared window and computes summary/breakdowns/active-days", () => {
    mockedUseUserProfile.mockReturnValue({
      user: {
        name: "Viewed",
        nickname: null,
        image: null,
        slug: "viewed-user",
        created_at: "2026-01-01T00:00:00Z",
        first_seen: null,
      },
      data: {
        user: {
          name: "Viewed",
          nickname: null,
          image: null,
          slug: "viewed-user",
          created_at: "2026-01-01T00:00:00Z",
          first_seen: null,
        },
        viewed_user_id: "viewed-id",
        records: [
          {
            source: "codex",
            model: "gpt-4o",
            hour_start: "2026-03-02T00:00:00Z",
            input_tokens: 1_000_000,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 1_000_000,
          },
          {
            source: "claude-code",
            model: "claude-sonnet-4-20250514",
            hour_start: "2026-03-03T00:00:00Z",
            input_tokens: 0,
            cached_input_tokens: 0,
            output_tokens: 100_000,
            reasoning_output_tokens: 0,
            total_tokens: 100_000,
          },
          {
            source: "codex",
            model: "gpt-4o",
            hour_start: "2026-02-20T00:00:00Z",
            input_tokens: 999,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 999,
          },
        ],
        summary: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
        },
      },
      daily: [],
      sources: [],
      models: [],
      heatmap: [],
      loading: false,
      error: null,
      notFound: false,
      refetch: vi.fn(),
    });

    mockedUseUsageData.mockReturnValue({
      data: {
        records: [
          {
            source: "codex",
            model: "gpt-4o",
            hour_start: "2026-03-03T12:00:00Z",
            input_tokens: 2_000_000,
            cached_input_tokens: 100_000,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 2_100_000,
          },
          {
            source: "codex",
            model: "gpt-4o",
            hour_start: "2026-03-04T12:00:00Z",
            input_tokens: 0,
            cached_input_tokens: 0,
            output_tokens: 100_000,
            reasoning_output_tokens: 0,
            total_tokens: 100_000,
          },
          {
            source: "codex",
            model: "gpt-4o",
            hour_start: "2026-03-10T12:00:00Z",
            input_tokens: 777,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: 777,
          },
        ],
        summary: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
        },
      },
      daily: [],
      sources: [],
      models: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
    });

    const result = useProfileCompare({
      slug: "viewed-user",
      from: "2026-03-01",
      to: "2026-03-05",
    });

    expect(mockedUseUserProfile).toHaveBeenCalledWith({
      slug: "viewed-user",
      from: "2026-03-01",
      to: "2026-03-05",
    });
    expect(mockedUseUsageData).toHaveBeenCalledWith({
      from: "2026-03-01",
      to: "2026-03-05",
    });

    expect(result.data).not.toBeNull();
    expect(result.data?.window).toEqual({ from: "2026-03-01", to: "2026-03-05", days: 4 });
    expect(result.data?.viewedUserId).toBe("viewed-id");

    expect(result.data?.a.summary.total_tokens).toBe(1_100_000);
    expect(result.data?.b.summary.total_tokens).toBe(2_200_000);

    expect(result.data?.summary.totalTokens.a).toBe(1_100_000);
    expect(result.data?.summary.totalTokens.b).toBe(2_200_000);
    expect(result.data?.summary.totalTokens.delta).toBe(1_100_000);

    expect(result.data?.summary.activeDays.a).toBe(2);
    expect(result.data?.summary.activeDays.b).toBe(2);
    expect(result.data?.summary.activeDays.delta).toBe(0);

    const codexSource = result.data?.sources.find((s) => s.source === "codex");
    expect(codexSource).toBeDefined();
    expect(codexSource?.a).toBe(1_000_000);
    expect(codexSource?.b).toBe(2_200_000);

    const modelRow = result.data?.models.find(
      (m) => m.model === "gpt-4o" && m.source === "codex",
    );
    expect(modelRow).toBeDefined();
    expect(modelRow?.aTotal).toBe(1_000_000);
    expect(modelRow?.bTotal).toBe(2_200_000);

    expect(result.loading).toBe(false);
    expect(result.error).toBeNull();
    expect(result.notFound).toBe(false);
    expect(result.hasAnyData).toBe(true);
  });

  it("surfaces loading/error/notFound and no-data states", () => {
    mockedUseUserProfile.mockReturnValue({
      user: null,
      data: null,
      daily: [],
      sources: [],
      models: [],
      heatmap: [],
      loading: true,
      error: null,
      notFound: true,
      refetch: vi.fn(),
    });

    mockedUseUsageData.mockReturnValue({
      data: null,
      daily: [],
      sources: [],
      models: [],
      loading: false,
      error: "Unauthorized",
      refetch: vi.fn(),
    });

    const result = useProfileCompare({ slug: "viewed-user", days: 30 });

    const viewedCall = mockedUseUserProfile.mock.calls[0]?.[0] as
      | { slug: string; from?: string; to?: string; days?: number }
      | undefined;
    expect(viewedCall?.slug).toBe("viewed-user");
    expect(viewedCall?.from).toEqual(expect.any(String));
    expect(viewedCall?.to).toEqual(expect.any(String));
    expect(viewedCall && "days" in viewedCall).toBe(false);

    expect(result.data).toBeNull();
    expect(result.loading).toBe(true);
    expect(result.error).toBe("Unauthorized");
    expect(result.notFound).toBe(true);
    expect(result.hasAnyData).toBe(false);
  });
});
