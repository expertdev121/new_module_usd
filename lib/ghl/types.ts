/**
 * Shared types for the GHL OAuth flow.
 */

/** Response shape from POST /oauth/token (both authorization_code and refresh_token grants). */
export interface GhlTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  userType: string;
  locationId?: string;
  companyId?: string;
  userId?: string;
  isBulkInstallation?: boolean;
}

/** Subset of the response from GET /locations/{id} that we actually use. */
export interface GhlLocationInfo {
  id: string;
  name: string | null;
  companyId?: string;
  business?: { name?: string | null };
}

/** Entry in the array returned by GET /oauth/installedLocations. */
export interface GhlInstalledLocation {
  _id: string;
  name?: string | null;
  address?: string | null;
  isInstalled?: boolean;
}

/** Response shape from POST /oauth/locationToken (agency-token → location-token). */
export interface GhlLocationTokenResponse extends GhlTokenResponse {
  locationId: string;
}

/** Reasons used on /oauth/error?reason=... */
export type OauthErrorReason =
  | "invalid_state"
  | "missing_code"
  | "token_exchange_failed"
  | "location_fetch_failed"
  | "storage_failed"
  | "missing_location"
  | "unknown";
