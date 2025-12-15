-- Migration: Expand productions.narrative_used CHECK constraint
-- Fixes error: violates check constraint "productions_narrative_used_check"
-- This keeps backward compatibility while allowing Narrative Engine v2+ narrative types.

ALTER TABLE productions
  DROP CONSTRAINT IF EXISTS productions_narrative_used_check;

ALTER TABLE productions
  ADD CONSTRAINT productions_narrative_used_check
  CHECK (
    narrative_used IS NULL OR narrative_used IN (
      'classic',
      'double_conflict',
      'hot_take',
      'perspective_clash',
      'viral_hook_heavy',
      'inverted_pyramid',
      'question_driven',
      'timeline_arc',
      'contrast_arc'
    )
  );

COMMENT ON CONSTRAINT productions_narrative_used_check ON productions IS
  'Allowed narrative types for Narrative Engine v2+ (NULL allowed).';

