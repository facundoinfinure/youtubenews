-- =============================================================================================
-- ChimpNews Narrative Engine v2.0 - Database Migration
-- =============================================================================================
-- This migration adds support for the v2.0 Narrative Engine features including:
-- - Narrative structure tracking (classic, double_conflict, hot_take, perspective_clash)
-- - Scene metadata storage (video_mode, model, shot)
-- - Enhanced host character fields (outfit, personality, gender)
-- - Seed image prompts for visual consistency
-- - Studio setup configuration
-- =============================================================================================

-- =============================================================================================
-- PRODUCTIONS TABLE UPDATES
-- =============================================================================================

-- Add narrative_used column if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'productions' AND column_name = 'narrative_used') THEN
        ALTER TABLE productions 
        ADD COLUMN narrative_used TEXT 
        CHECK (narrative_used IN ('classic', 'double_conflict', 'hot_take', 'perspective_clash'));
        
        COMMENT ON COLUMN productions.narrative_used IS 
            'The narrative structure used: classic (6 scenes), double_conflict (7), hot_take (4), perspective_clash (6)';
    END IF;
END $$;

-- Add scenes column to store full scene structure with metadata
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'productions' AND column_name = 'scenes') THEN
        ALTER TABLE productions 
        ADD COLUMN scenes JSONB;
        
        COMMENT ON COLUMN productions.scenes IS 
            'Full scene structure from v2.0 Narrative Engine: {title, narrative_used, scenes: {1: {text, video_mode, model, shot}, ...}}';
    END IF;
END $$;

-- Add audio_normalized flag to track if audio was processed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'productions' AND column_name = 'audio_normalized') THEN
        ALTER TABLE productions 
        ADD COLUMN audio_normalized BOOLEAN DEFAULT FALSE;
        
        COMMENT ON COLUMN productions.audio_normalized IS 
            'Whether audio segments have been normalized to -16 LUFS';
    END IF;
END $$;

-- Add video_composition_url for final composed video
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'productions' AND column_name = 'video_composition_url') THEN
        ALTER TABLE productions 
        ADD COLUMN video_composition_url TEXT;
        
        COMMENT ON COLUMN productions.video_composition_url IS 
            'URL to the final composed video (after FFmpeg processing)';
    END IF;
END $$;

-- Add composition_status for tracking server-side rendering
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'productions' AND column_name = 'composition_status') THEN
        ALTER TABLE productions 
        ADD COLUMN composition_status TEXT DEFAULT 'pending'
        CHECK (composition_status IN ('pending', 'processing', 'completed', 'failed'));
        
        COMMENT ON COLUMN productions.composition_status IS 
            'Status of video composition: pending, processing, completed, failed';
    END IF;
END $$;

-- =============================================================================================
-- CHANNELS TABLE UPDATES (for v2.0 character configuration)
-- =============================================================================================

-- The config JSONB column in channels table should now support:
-- config.characters.hostA.outfit
-- config.characters.hostA.personality
-- config.characters.hostA.gender
-- config.characters.hostB.outfit
-- config.characters.hostB.personality
-- config.characters.hostB.gender
-- config.seedImages.hostASolo
-- config.seedImages.hostBSolo
-- config.seedImages.twoShot
-- config.studioSetup

-- Add a comment to document the expected structure
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
  referenceImageUrl: string,
  characters: {
    hostA: {
      id: "hostA",
      name: string,
      bio: string,
      visualPrompt: string,
      voiceName: string (echo recommended),
      outfit: string (e.g. "dark hoodie"),
      personality: string,
      gender: "male" | "female"
    },
    hostB: {
      id: "hostB",
      name: string,
      bio: string,
      visualPrompt: string,
      voiceName: string (shimmer recommended),
      outfit: string (e.g. "teal blazer and white shirt"),
      personality: string,
      gender: "male" | "female"
    }
  },
  seedImages: {
    hostASolo: string (prompt for solo hostA image),
    hostBSolo: string (prompt for solo hostB image),
    twoShot: string (prompt for both hosts)
  },
  studioSetup: string (description of podcast studio)
}';

-- =============================================================================================
-- GENERATED VIDEOS TABLE UPDATES
-- =============================================================================================

-- Add scene_metadata column for storing scene builder output
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'generated_videos' AND column_name = 'scene_metadata') THEN
        ALTER TABLE generated_videos 
        ADD COLUMN scene_metadata JSONB;
        
        COMMENT ON COLUMN generated_videos.scene_metadata IS 
            'Scene Builder metadata: {sceneNumber, shot, video_mode, lightingMood, expressionHint, visualPrompt}';
    END IF;
END $$;

-- Add lighting_mood for tracking scene atmosphere
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'generated_videos' AND column_name = 'lighting_mood') THEN
        ALTER TABLE generated_videos 
        ADD COLUMN lighting_mood TEXT
        CHECK (lighting_mood IN ('neutral', 'dramatic', 'warm', 'cool'));
    END IF;
END $$;

-- Add shot_type for quick filtering
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'generated_videos' AND column_name = 'shot_type') THEN
        ALTER TABLE generated_videos 
        ADD COLUMN shot_type TEXT
        CHECK (shot_type IN ('medium', 'closeup', 'wide'));
    END IF;
END $$;

-- =============================================================================================
-- AUDIO CACHE TABLE UPDATES
-- =============================================================================================

-- Add normalized flag to audio cache
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'audio_cache' AND column_name = 'normalized') THEN
        ALTER TABLE audio_cache 
        ADD COLUMN normalized BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add peak_db and rms_db for audio analysis
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'audio_cache' AND column_name = 'peak_db') THEN
        ALTER TABLE audio_cache 
        ADD COLUMN peak_db REAL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'audio_cache' AND column_name = 'rms_db') THEN
        ALTER TABLE audio_cache 
        ADD COLUMN rms_db REAL;
    END IF;
END $$;

-- =============================================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================================

-- Index for narrative type queries
CREATE INDEX IF NOT EXISTS idx_productions_narrative_used 
ON productions (narrative_used) 
WHERE narrative_used IS NOT NULL;

-- Index for composition status queries
CREATE INDEX IF NOT EXISTS idx_productions_composition_status 
ON productions (composition_status) 
WHERE composition_status IS NOT NULL;

-- Index for video shot type queries
CREATE INDEX IF NOT EXISTS idx_generated_videos_shot_type 
ON generated_videos (shot_type) 
WHERE shot_type IS NOT NULL;

-- Index for lighting mood queries
CREATE INDEX IF NOT EXISTS idx_generated_videos_lighting_mood 
ON generated_videos (lighting_mood) 
WHERE lighting_mood IS NOT NULL;

-- =============================================================================================
-- DEFAULT NARRATIVE ENGINE SETTINGS (Insert into channels if needed)
-- =============================================================================================

-- Function to ensure default seed images exist in channel config
CREATE OR REPLACE FUNCTION ensure_narrative_engine_defaults(channel_config JSONB)
RETURNS JSONB AS $$
DECLARE
    default_seed_images JSONB;
    default_studio_setup TEXT;
BEGIN
    -- Default seed images per ChimpNews spec v2.0
    default_seed_images := jsonb_build_object(
        'hostASolo', 'Ultra-detailed 3D render of a male chimpanzee podcaster wearing a dark hoodie, at a modern podcast desk. Sarcastic expression, relaxed posture. Warm tungsten key light + purple/blue LED accents. Acoustic foam panels, Shure SM7B microphone. Medium shot, eye-level.',
        'hostBSolo', 'Ultra-detailed 3D render of a female chimpanzee podcaster wearing a teal blazer and white shirt. Playful, expressive look. Warm tungsten lighting + purple/blue LEDs. Acoustic foam panels. Medium shot, eye-level.',
        'twoShot', 'Ultra-detailed 3D render of hostA and hostB at a sleek podcast desk. hostA in dark hoodie, hostB in teal blazer. Warm tungsten key light, purple/blue LEDs, Shure SM7B mics. Medium two-shot, eye-level.'
    );
    
    default_studio_setup := 'modern podcast room, warm tungsten key light, purple/blue LED accents, acoustic foam panels, Shure SM7B microphones, camera: eye-level, shallow depth of field';
    
    -- Add seed images if not present
    IF NOT (channel_config ? 'seedImages') OR channel_config->'seedImages' IS NULL THEN
        channel_config := jsonb_set(channel_config, '{seedImages}', default_seed_images);
    ELSE
        -- Merge with existing, keeping user values
        channel_config := jsonb_set(
            channel_config, 
            '{seedImages}', 
            default_seed_images || (channel_config->'seedImages')
        );
    END IF;
    
    -- Add studio setup if not present
    IF NOT (channel_config ? 'studioSetup') OR channel_config->>'studioSetup' IS NULL OR channel_config->>'studioSetup' = '' THEN
        channel_config := jsonb_set(channel_config, '{studioSetup}', to_jsonb(default_studio_setup));
    END IF;
    
    RETURN channel_config;
END;
$$ LANGUAGE plpgsql;

-- Apply defaults to existing channels that don't have them
UPDATE channels
SET config = ensure_narrative_engine_defaults(config)
WHERE config IS NOT NULL
  AND (
      NOT (config ? 'seedImages') 
      OR config->'seedImages' IS NULL
      OR NOT (config ? 'studioSetup')
      OR config->>'studioSetup' IS NULL
      OR config->>'studioSetup' = ''
  );

-- =============================================================================================
-- VIEWS FOR ANALYTICS
-- =============================================================================================

-- View to analyze narrative structure usage
CREATE OR REPLACE VIEW narrative_analytics AS
SELECT 
    c.name AS channel_name,
    p.narrative_used,
    COUNT(*) AS production_count,
    AVG(p.actual_cost) AS avg_cost,
    MIN(p.created_at) AS first_used,
    MAX(p.created_at) AS last_used
FROM productions p
JOIN channels c ON p.channel_id = c.id
WHERE p.narrative_used IS NOT NULL
GROUP BY c.name, p.narrative_used
ORDER BY c.name, production_count DESC;

-- View to analyze shot type distribution per narrative
CREATE OR REPLACE VIEW shot_distribution AS
SELECT 
    p.narrative_used,
    gv.shot_type,
    COUNT(*) AS segment_count
FROM generated_videos gv
JOIN productions p ON gv.production_id = p.id
WHERE gv.shot_type IS NOT NULL AND p.narrative_used IS NOT NULL
GROUP BY p.narrative_used, gv.shot_type
ORDER BY p.narrative_used, segment_count DESC;

-- =============================================================================================
-- MIGRATION COMPLETE
-- =============================================================================================

SELECT 'ChimpNews Narrative Engine v2.0 migration completed successfully!' AS status;
