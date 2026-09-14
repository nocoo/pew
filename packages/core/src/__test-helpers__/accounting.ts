export function accountingFixture() {
  const basis = { input_tokens: 100, cached_input_tokens: 800, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: 940 };
  return {
    details_version: 1, source: "codex", model: "gpt-6-astra", device_id: "test-device",
    hour_start: "2026-09-01T00:00:00.000Z", event_id: null, evidence_snapshot_seq: null,
    source_revision: 1, parser_revision: 1, detail_revision: 1, basis,
    groups: [{
      basis, counts: { input_total_tokens: 900, cache_read_input_tokens: 800,
        cache_write_input_tokens: 90, cache_write_5m_input_tokens: null,
        cache_write_1h_input_tokens: null, output_total_tokens: 40, reasoning_output_tokens: 10 },
      origin: "codex:last_token_usage", model: "gpt-6-astra", provider: "openai", route: null,
      service_tier: "default", context_tokens_min: 900, context_tokens_max: 900,
      request_count: 1, quality: "reported", reported_costs: [], diagnostics: [],
    }],
  };
}

/** The same adversarial inputs exercise the server and the independently shipped CLI boundary. */
export function invalidAccountingCases(): Array<[string, unknown]> {
  const r = accountingFixture();
  const first = r.groups[0];
  if (!first) throw new Error("Expected accounting fixture group");
  const group = (patch: Record<string, unknown>) => ({ ...r, groups: [{ ...first, ...patch }] });
  const counts = (patch: Record<string, unknown>) => group({ counts: { ...first.counts, ...patch } });
  const amount = { units: "10", scale: 10, currency: "USD", kind: "actual", status: "complete", source: "grok-server" };
  const money = (patch: Record<string, unknown>) => group({ reported_costs: [{ ...amount, ...patch }] });
  return [
    ["null envelope", null], ["array envelope", []], ["future version", { ...r, details_version: 2 }],
    ["raw body", { ...r, prompt: "PRIVATE" }], ["unknown source", { ...r, source: "synthetic-source" }],
    ["private model", { ...r, model: "sk-PRIVATE" }], ["device path", { ...r, device_id: "/private/device" }],
    ["local timestamp", { ...r, hour_start: "2026-09-01T00:00:00+08:00" }],
    ["impossible date", { ...r, hour_start: "2026-02-30T00:00:00.000Z" }],
    ["unaligned bucket", { ...r, hour_start: "2026-09-01T00:01:00.000Z" }],
    ["raw event id", { ...r, event_id: "raw-session-id", evidence_snapshot_seq: 1 }],
    ["missing evidence sequence", { ...r, event_id: "a".repeat(64) }],
    ["zero evidence sequence", { ...r, event_id: "a".repeat(64), evidence_snapshot_seq: 0 }],
    ["unexpected legacy sequence", { ...r, evidence_snapshot_seq: 1 }],
    ["zero revision", { ...r, source_revision: 0 }],
    ["unsafe revision", { ...r, parser_revision: Number.MAX_SAFE_INTEGER + 1 }],
    ["fractional revision", { ...r, detail_revision: 1.5 }],
    ["missing basis", { ...r, basis: null }],
    ["unbalanced basis", { ...r, basis: { ...r.basis, total_tokens: 939 } }],
    ["negative basis", { ...r, basis: { ...r.basis, input_tokens: -1 } }],
    ["private basis", { ...r, basis: { ...r.basis, transcript: "PRIVATE" } }],
    ["no groups", { ...r, groups: [] }], ["too many groups", { ...r, groups: Array(257).fill(r.groups[0]) }],
    ["null group", { ...r, groups: [null] }], ["raw group", group({ messages: ["PRIVATE"] })],
    ["invalid origin", group({ origin: "BearerPRIVATE" })], ["private provider", group({ provider: "https://private.invalid" })],
    ["private route", group({ route: "file:///private" })], ["invalid tier", group({ service_tier: { secret: "PRIVATE" } })],
    ["unknown quality", group({ quality: "guess" })], ["reported without counters", group({ counts: null })],
    ["legacy with reported counters", group({ quality: "legacy" })], ["counts array", group({ counts: [] })],
    ["private counts", counts({ authorization: "PRIVATE" })],
    ["fractional input", counts({ input_total_tokens: 900.5 })], ["nonfinite input", counts({ input_total_tokens: Infinity })],
    ["wrong input crosswalk", counts({ input_total_tokens: 901 })], ["wrong output crosswalk", counts({ output_total_tokens: 41 })],
    ["negative read", counts({ cache_read_input_tokens: -1 })], ["overlapping input subsets", counts({ cache_write_input_tokens: 101 })],
    ["TTL without write total", counts({ cache_write_input_tokens: null, cache_write_1h_input_tokens: 0 })],
    ["overlapping TTL subsets", counts({ cache_write_5m_input_tokens: 80, cache_write_1h_input_tokens: 20 })],
    ["reasoning exceeds output", counts({ reasoning_output_tokens: 41 })],
    ["context missing upper bound", group({ context_tokens_max: null })],
    ["reversed context range", group({ context_tokens_max: 899 })], ["fractional context", group({ context_tokens_min: 0.5 })],
    ["context without requests", group({ request_count: 0 })], ["unsafe requests", group({ request_count: -1 })],
    ["nonarray money", group({ reported_costs: {} })], ["too many amounts", group({ reported_costs: Array(5).fill(amount) })],
    ["floating units", money({ units: 10 })], ["fractional units", money({ units: "1.2" })],
    ["negative units", money({ units: "-1" })], ["oversized units", money({ units: "1".repeat(61) })],
    ["noncanonical units", money({ units: "01" })], ["unsupported scale", money({ scale: 19 })],
    ["negative scale", money({ scale: -1 })], ["unsupported currency", money({ currency: "EUR" })],
    ["unknown money kind", money({ kind: "paid" })], ["unknown money status", money({ status: "free" })],
    ["private money source", money({ source: "https://private.invalid" })], ["private money object", money({ body: "PRIVATE" })],
    ["nonarray diagnostics", group({ diagnostics: {} })],
    ["too many diagnostics", group({ diagnostics: Array(4).fill({ code: "invalid_counts", raw_total_tokens: null }) })],
    ["unprojected diagnostic", group({ diagnostics: [{ code: "error", raw_total_tokens: null }] })],
    ["negative diagnostic total", group({ diagnostics: [{ code: "total_mismatch", raw_total_tokens: -1 }] })],
    ["groups fail partition", { ...r, groups: [...r.groups, ...r.groups] }],
  ];
}
