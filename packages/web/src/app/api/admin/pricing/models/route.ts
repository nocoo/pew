/**
 * GET /api/admin/pricing/models — admin-only view of dynamic pricing entries.
 *
 * Kept as a backwards-compatible alias of the now-public /api/pricing/models
 * route; both share the same handler. Strictly read-only.
 */

import { resolveUser } from "@/lib/auth-helpers";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-responses";
import { isAdminUser } from "@/lib/admin";
import { fetchDynamicPricingPayload } from "@/lib/pricing-models-handler";

export async function GET(request: Request) {
  const authResult = await resolveUser(request);
  if (!authResult) {
    return unauthorizedResponse();
  }

  const admin = await isAdminUser(authResult);
  if (!admin) {
    return forbiddenResponse();
  }

  return fetchDynamicPricingPayload();
}
