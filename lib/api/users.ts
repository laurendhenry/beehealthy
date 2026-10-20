import type {
  ReplaceProfileRequest,
  UpdateProfileRequest,
  UserMeResponse,
  UserProfileResponse,
} from "../../types/api";
import { apiRequest, type TransportDeps } from "./client";

/**
 * User endpoints (paths relative to `/api`).
 * - `GET /users/me` → current user + profile.
 * - `PUT /users/me/profile` → full replacement (omitted fields default).
 * - `PATCH /users/me/profile` → partial update (omitted fields preserved).
 * - `DELETE /users/me/profile` → 204 preference reset (NOT account deletion).
 */
export function getMe(deps?: TransportDeps): Promise<UserMeResponse> {
  return apiRequest<UserMeResponse>("/users/me", { method: "GET" }, deps);
}

export function replaceProfile(
  body: ReplaceProfileRequest,
  deps?: TransportDeps,
): Promise<UserProfileResponse> {
  return apiRequest<UserProfileResponse>(
    "/users/me/profile",
    { method: "PUT", body },
    deps,
  );
}

export function updateProfile(
  body: UpdateProfileRequest,
  deps?: TransportDeps,
): Promise<UserProfileResponse> {
  return apiRequest<UserProfileResponse>(
    "/users/me/profile",
    { method: "PATCH", body },
    deps,
  );
}

/** Reset preferences to defaults. Resolves on 204; never deletes the account. */
export async function resetProfile(deps?: TransportDeps): Promise<void> {
  await apiRequest<void>("/users/me/profile", { method: "DELETE" }, deps);
}
