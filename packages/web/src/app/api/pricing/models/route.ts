/**
 * GET /api/pricing/models — public (authenticated user) view of dynamic
 * pricing entries.
 *
 * Returns the same payload as /api/admin/pricing/models but only requires
 * the caller to be a logged-in user. Used by the user-facing /model-prices
 * page and the model-info hover card across the dashboard.
 */

import { resolveUser } from "@/lib/auth-helpers";
import { unauthorizedResponse } from "@/lib/api-responses";
import { fetchDynamicPricingPayload } from "@/lib/pricing-models-handler";

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return unauthorizedResponse();
  }

  return fetchDynamicPricingPayload();
}
