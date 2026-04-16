export type UserAccessType = "full" | "trial";

export type TrialAccessState = {
  accessType: UserAccessType;
  trialDays: number;
  trialEndsAt: string | null;
  trialExpired: boolean;
  remainingMs: number | null;
  graceDays: number;
  deletionRetentionDays: number;
  graceEndsAt: string | null;
  deletionScheduledAt: string | null;
  graceRemainingMs: number | null;
  accessLocked: boolean;
};

const DEFAULT_TRIAL_DAYS = 60;
const DEFAULT_GRACE_DAYS = 7;
const DEFAULT_DELETION_RETENTION_DAYS = 30;

export function getTrialDaysFromEnv() {
  const rawValue = process.env.FREE_TRIAL_DAYS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return DEFAULT_TRIAL_DAYS;
  }

  return parsedValue;
}

export function getTrialGraceDaysFromEnv() {
  const rawValue = process.env.FREE_TRIAL_GRACE_DAYS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return DEFAULT_GRACE_DAYS;
  }

  return parsedValue;
}

export function getTrialDeletionRetentionDaysFromEnv() {
  const rawValue = process.env.FREE_TRIAL_DELETION_RETENTION_DAYS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return DEFAULT_DELETION_RETENTION_DAYS;
  }

  return parsedValue;
}

export function getTrialAccessState(params: {
  accessType?: string | null;
  createdAt?: Date | string | null;
  now?: Date;
}): TrialAccessState {
  const accessType: UserAccessType =
    params.accessType === "trial" ? "trial" : "full";
  const trialDays = getTrialDaysFromEnv();
  const graceDays = getTrialGraceDaysFromEnv();
  const deletionRetentionDays = getTrialDeletionRetentionDaysFromEnv();

  if (accessType !== "trial" || !params.createdAt) {
    return {
      accessType,
      trialDays,
      trialEndsAt: null,
      trialExpired: false,
      remainingMs: null,
      graceDays,
      deletionRetentionDays,
      graceEndsAt: null,
      deletionScheduledAt: null,
      graceRemainingMs: null,
      accessLocked: false,
    };
  }

  const createdAt =
    params.createdAt instanceof Date
      ? params.createdAt
      : new Date(params.createdAt);
  const now = params.now ?? new Date();
  const trialEndsAtDate = new Date(
    createdAt.getTime() + trialDays * 24 * 60 * 60 * 1000
  );
  const graceEndsAtDate = new Date(
    trialEndsAtDate.getTime() + graceDays * 24 * 60 * 60 * 1000
  );
  const deletionScheduledAtDate = new Date(
    trialEndsAtDate.getTime() + deletionRetentionDays * 24 * 60 * 60 * 1000
  );
  const remainingMs = trialEndsAtDate.getTime() - now.getTime();
  const graceRemainingMs = graceEndsAtDate.getTime() - now.getTime();
  const trialExpired = remainingMs <= 0;

  return {
    accessType,
    trialDays,
    trialEndsAt: trialEndsAtDate.toISOString(),
    trialExpired,
    remainingMs: Math.max(remainingMs, 0),
    graceDays,
    deletionRetentionDays,
    graceEndsAt: graceEndsAtDate.toISOString(),
    deletionScheduledAt: deletionScheduledAtDate.toISOString(),
    graceRemainingMs: Math.max(graceRemainingMs, 0),
    accessLocked: trialExpired,
  };
}
