/**
 * How long personal data is kept before the daily retention job clears it
 * (spec §11 "retention periods set per data type"). ILLUSTRATIVE until counsel
 * confirms them; the database refuses anything shorter than its floors
 * (migration 0017: 90 / 180 / 30 days).
 *
 *   location   exact location of phone punches (the punch time stays)
 *   aiTexts    question and answer texts of AI interactions (the log line stays)
 *   staging    staged rows of finished data-migration batches (the records stay)
 *   applicants applicants who were not hired: their CV and their details (how many
 *              applied for an opening stays, because that is not personal data)
 */
export const RETENTION_DAYS = {
  location: 180,
  aiTexts: 365,
  staging: 90,
  applicants: 365,
} as const;

export function retentionCutoffs(now: Date) {
  const before = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    location: before(RETENTION_DAYS.location),
    aiTexts: before(RETENTION_DAYS.aiTexts),
    staging: before(RETENTION_DAYS.staging),
    // the applicant's own retention date is already stored on the row (consent + period);
    // this is only the "nothing newer than today" bound the SQL function needs
    applicants: now,
  };
}
