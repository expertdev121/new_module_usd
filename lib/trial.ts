export type UserAccessType = "full" | "trial";

export type TrialAccessState = {
  accessType: UserAccessType;
  trialDays: number;
  trialEndsAt: string | null;
  trialExpired: boolean;
  remainingMs: number | null;
};

const DEFAULT_TRIAL_DAYS = 60;

export function getTrialDaysFromEnv() {
  const rawValue = process.env.FREE_TRIAL_DAYS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return DEFAULT_TRIAL_DAYS;
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

  if (accessType !== "trial" || !params.createdAt) {
    return {
      accessType,
      trialDays,
      trialEndsAt: null,
      trialExpired: false,
      remainingMs: null,
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
  const remainingMs = trialEndsAtDate.getTime() - now.getTime();

  return {
    accessType,
    trialDays,
    trialEndsAt: trialEndsAtDate.toISOString(),
    trialExpired: remainingMs <= 0,
    remainingMs: Math.max(remainingMs, 0),
  };
}
