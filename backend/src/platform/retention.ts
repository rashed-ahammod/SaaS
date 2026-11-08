/**
 * How long personal data is kept before the daily retention job clears it
 * (spec §11 "retention periods set per data type"). ILLUSTRATIVE until counsel
 * confirms them; the database refuses anything shorter than its floors
 * (migration 0017: 90 / 180 / 30 days).
 *
 *   location   exact location of phone punches (the punch time stays)
 *   aiTexts    question and answer texts of AI interactions (the log line stays)
 *   staging    staged rows of finished data-migration batches (the records stay)
 */
export const RETENTION_DAYS = {
  location: 180,
  aiTexts: 365,
  staging: 90,
} as const;

export function retentionCutoffs(now: Date) {
  const before = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    location: before(RETENTION_DAYS.location),
    aiTexts: before(RETENTION_DAYS.aiTexts),
    staging: before(RETENTION_DAYS.staging),
  };
}
