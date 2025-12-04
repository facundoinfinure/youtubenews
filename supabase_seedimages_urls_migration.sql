-- =============================================================================================
-- ChimpNews Seed Images URLs Migration
-- =============================================================================================
-- This migration documents the new URL fields for seed images in the channels.config JSONB
-- The URLs store references to generated/uploaded images in Supabase Storage
-- =============================================================================================

-- Update the comment on channels.config to document the new URL fields
COMMENT ON COLUMN channels.config IS 
'Channel configuration JSON including:
{
  channelName: string,
  tagline: string,
  country: string,
  language: string,
  format: "16:9" | "9:16",
  tone: string,
  logoColor1: string,
  logoColor2: string,
  captionsEnabled: boolean,
  defaultTags: string[],
  characters: {
    hostA: {
      id: "hostA",
      name: string,
      bio: string (legacy, use personality),
      visualPrompt: string,
      voiceName: string (OpenAI TTS: echo, shimmer, alloy, fable, onyx, nova),
      outfit: string (e.g. "dark hoodie"),
      personality: string (detailed personality and political stance),
      gender: "male" | "female"
    },
    hostB: {
      id: "hostB",
      name: string,
      bio: string (legacy, use personality),
      visualPrompt: string,
      voiceName: string (OpenAI TTS: echo, shimmer, alloy, fable, onyx, nova),
      outfit: string (e.g. "teal blazer and white shirt"),
      personality: string (detailed personality and political stance),
      gender: "male" | "female"
    }
  },
  seedImages: {
    hostASolo: string (prompt for generating hostA solo image),
    hostBSolo: string (prompt for generating hostB solo image),
    twoShot: string (prompt for generating both hosts image),
    hostASoloUrl: string (URL to generated/uploaded hostA image in Supabase Storage),
    hostBSoloUrl: string (URL to generated/uploaded hostB image in Supabase Storage),
    twoShotUrl: string (URL to generated/uploaded two-shot image in Supabase Storage)
  },
  studioSetup: string (description of podcast studio environment)
}

Note: seedImages URLs are stored in Supabase Storage bucket "channel-assets/channel-images/"
Files are named: seed-{hostASolo|hostBSolo|twoShot}-{channelId}-{timestamp}.png';

-- =============================================================================================
-- Verify Storage Bucket Exists
-- =============================================================================================
-- Make sure the channel-assets bucket exists and has proper policies
-- This should be run from Supabase Dashboard or via Storage API

-- Expected bucket structure:
-- channel-assets/
--   channel-images/
--     seed-hostASolo-{uuid}-{timestamp}.png
--     seed-hostBSolo-{uuid}-{timestamp}.png
--     seed-twoshot-{uuid}-{timestamp}.png
--     thumbnails/
--     ...

-- =============================================================================================
-- MIGRATION COMPLETE
-- =============================================================================================

SELECT 'Seed Images URLs migration completed. Config JSONB now supports seedImages.hostASoloUrl, hostBSoloUrl, twoShotUrl' AS status;
