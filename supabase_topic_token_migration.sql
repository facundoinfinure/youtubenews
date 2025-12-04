-- ============================================================================
-- TOPIC TOKEN MIGRATION (Documentation Only)
-- ============================================================================
-- Date: 2025-12-04
-- Description: Documents the new topicToken field in channels.config JSONB
-- Note: No actual migration needed - config is JSONB and accepts new fields
-- ============================================================================

-- The channels.config JSONB field now supports a topicToken property
-- This token is used to fetch news from Google News API via SerpAPI

-- Example topic tokens:
-- Business (US/en): CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB
-- Argentina:        CAAqJQgKIh9DQkFTRVFvSEwyMHZNR3BuWkJJR1pYTXROREU1S0FBUAE
-- Technology:       CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB

-- How to find topic tokens:
-- 1. Go to Google News (news.google.com)
-- 2. Navigate to a topic (Business, Technology, Argentina, etc.)
-- 3. The topic_token is in the URL after /topics/
-- 4. Or use SerpAPI playground to get the token

-- Update example for ChimpNewsUSA (Business topic):
UPDATE channels 
SET config = jsonb_set(
  config, 
  '{topicToken}', 
  '"CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB"'
)
WHERE name = 'ChimpNewsUSA';

-- Update example for ArgeNews (Argentina topic):
UPDATE channels 
SET config = jsonb_set(
  config, 
  '{topicToken}', 
  '"CAAqJQgKIh9DQkFTRVFvSEwyMHZNR3BuWkJJR1pYTXROREU1S0FBUAE"'
)
WHERE name = 'ArgeNews';

-- Verify the update:
-- SELECT name, config->>'topicToken' as topic_token FROM channels;

-- Updated config structure:
COMMENT ON COLUMN channels.config IS 
'Channel configuration JSON with the following structure:
{
  "channelName": "string",
  "tagline": "string",
  "country": "string",
  "language": "string",
  "format": "16:9 | 9:16",
  "tone": "string",
  "logoColor1": "hex color",
  "logoColor2": "hex color",
  "captionsEnabled": "boolean",
  "defaultTags": ["string array"],
  "referenceImageUrl": "optional string",
  "topicToken": "optional string - Google News topic token for news fetching",
  "characters": {
    "hostA": { "name", "personality", "gender" },
    "hostB": { "name", "personality", "gender" }
  },
  "seedImages": {
    "hostASolo": "prompt",
    "hostBSolo": "prompt", 
    "twoShot": "prompt",
    "hostASoloUrl": "url",
    "hostBSoloUrl": "url",
    "twoShotUrl": "url"
  },
  "studioSetup": "optional string",
  "preferredNarrative": "optional NarrativeType"
}';
