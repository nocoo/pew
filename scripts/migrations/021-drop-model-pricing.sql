-- ============================================================
-- 021: drop the legacy admin-managed model_pricing table.
--
-- Background:
--   The dynamic pricing pipeline (worker-read sync/orchestrator + bundled
--   baseline + openrouter + models.dev, served via KV `pricing:dynamic`)
--   replaced the admin-CRUD model_pricing table. The corresponding admin
--   UI (/admin/pricing), API (/api/admin/pricing*), web RPC methods
--   (listModelPricing*, getModelPricingByModelSource), worker-read
--   admin-loader, "admin" pricing origin, and `pricing:all` KV cache
--   key were all removed in the same atomic cleanup. The table is empty
--   in production at the time of this migration, so a destructive DROP
--   is safe.
--
-- After applying this migration, also delete the obsolete KV key:
--   wrangler kv key delete --binding=PRICING_KV pricing:all
-- ============================================================

DROP TABLE IF EXISTS model_pricing;
