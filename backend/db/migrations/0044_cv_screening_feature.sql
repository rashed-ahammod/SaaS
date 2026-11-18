-- =============================================================================
-- 0044  The AI feature list gains 'cv_screening' (WP29)
--
-- ai_usage and ai_interactions name every feature in a CHECK, so a new AI feature needs a
-- migration of its own (this is how 0031 added bank matching and 0034 the document reader).
-- Separate from 0043 because migrations are forward-only: 0043 was already applied.
-- =============================================================================

ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_feature_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion', 'document_reader', 'cv_screening'));
ALTER TABLE ai_interactions DROP CONSTRAINT ai_interactions_feature_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion', 'document_reader', 'cv_screening'));
