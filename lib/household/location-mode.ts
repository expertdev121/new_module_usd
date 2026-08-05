/**
 * Reads the per-location `account_type` setting. Cached per request so
 * a page render doesn't hit the DB more than once for the same tenant.
 *
 * Missing row = "individual" (the default for every existing tenant).
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { locationSettings, type AccountType } from "@/lib/db/schema-household";

const CACHE = new Map<string, { value: AccountType; at: number }>();
const TTL_MS = 30_000;

export async function getAccountType(locationId: string): Promise<AccountType> {
  if (!locationId) return "individual";
  const hit = CACHE.get(locationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const rows = await db
    .select({ accountType: locationSettings.accountType })
    .from(locationSettings)
    .where(eq(locationSettings.locationId, locationId))
    .limit(1);
  const value = (rows[0]?.accountType as AccountType | undefined) ?? "individual";
  CACHE.set(locationId, { value, at: Date.now() });
  return value;
}

export function invalidateAccountTypeCache(locationId?: string) {
  if (locationId) CACHE.delete(locationId);
  else CACHE.clear();
}

export async function isHouseholdMode(locationId: string): Promise<boolean> {
  return (await getAccountType(locationId)) === "household";
}

export async function setAccountType(
  locationId: string,
  accountType: AccountType,
): Promise<void> {
  const now = new Date();
  await db
    .insert(locationSettings)
    .values({ locationId, accountType, updatedAt: now })
    .onConflictDoUpdate({
      target: locationSettings.locationId,
      set: { accountType, updatedAt: now },
    });
  invalidateAccountTypeCache(locationId);
}
