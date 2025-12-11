-- =============================================================================================
-- VIDEO ANALYTICS TABLE - YouTube Performance Tracking
-- Run this migration in Supabase SQL Editor
-- =============================================================================================

-- Create the video_analytics table
CREATE TABLE IF NOT EXISTS video_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  youtube_video_id TEXT NOT NULL,
  
  -- Basic stats from YouTube Data API
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  
  -- Advanced metrics from YouTube Analytics API
  estimated_minutes_watched REAL,
  average_view_duration REAL, -- in seconds
  average_view_percentage REAL, -- retention percentage (0-100)
  click_through_rate REAL, -- thumbnail CTR (0-100)
  shares INTEGER DEFAULT 0,
  subscribers_gained INTEGER DEFAULT 0,
  
  -- Calculated metrics
  engagement_rate REAL, -- (likes + comments) / views * 100
  
  -- Timestamps
  video_published_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicates
  UNIQUE(production_id, youtube_video_id)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_video_analytics_channel_id ON video_analytics(channel_id);
CREATE INDEX IF NOT EXISTS idx_video_analytics_production_id ON video_analytics(production_id);
CREATE INDEX IF NOT EXISTS idx_video_analytics_published_at ON video_analytics(video_published_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_analytics_fetched_at ON video_analytics(fetched_at DESC);

-- Enable RLS
ALTER TABLE video_analytics ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read analytics for channels they have access to
CREATE POLICY "Users can view video analytics"
  ON video_analytics FOR SELECT
  USING (true); -- Adjust based on your auth requirements

-- Policy: Users can insert/update analytics
CREATE POLICY "Users can insert video analytics"
  ON video_analytics FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update video analytics"
  ON video_analytics FOR UPDATE
  USING (true);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_video_analytics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-updating updated_at
DROP TRIGGER IF EXISTS trigger_video_analytics_updated_at ON video_analytics;
CREATE TRIGGER trigger_video_analytics_updated_at
  BEFORE UPDATE ON video_analytics
  FOR EACH ROW
  EXECUTE FUNCTION update_video_analytics_updated_at();

-- =============================================================================================
-- ANALYTICS FETCH LOG - Track when analytics were last fetched
-- =============================================================================================

CREATE TABLE IF NOT EXISTS analytics_fetch_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  videos_updated INTEGER DEFAULT 0,
  fetch_type TEXT DEFAULT 'manual', -- 'manual' or 'scheduled'
  status TEXT DEFAULT 'success', -- 'success', 'partial', 'failed'
  error_message TEXT,
  
  UNIQUE(channel_id, fetched_at)
);

CREATE INDEX IF NOT EXISTS idx_analytics_fetch_log_channel_id ON analytics_fetch_log(channel_id);
CREATE INDEX IF NOT EXISTS idx_analytics_fetch_log_fetched_at ON analytics_fetch_log(fetched_at DESC);

-- Enable RLS
ALTER TABLE analytics_fetch_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view analytics fetch log"
  ON analytics_fetch_log FOR SELECT
  USING (true);

CREATE POLICY "Users can insert analytics fetch log"
  ON analytics_fetch_log FOR INSERT
  WITH CHECK (true);

-- =============================================================================================
-- HELPFUL VIEWS
-- =============================================================================================

-- View for channel analytics summary
CREATE OR REPLACE VIEW channel_analytics_summary AS
SELECT 
  channel_id,
  COUNT(*) as total_videos,
  SUM(view_count) as total_views,
  SUM(like_count) as total_likes,
  SUM(comment_count) as total_comments,
  AVG(view_count) as avg_views_per_video,
  AVG(engagement_rate) as avg_engagement_rate,
  AVG(average_view_duration) as avg_view_duration,
  MAX(fetched_at) as last_updated
FROM video_analytics
GROUP BY channel_id;

-- Grant access to views
GRANT SELECT ON channel_analytics_summary TO authenticated;
GRANT SELECT ON channel_analytics_summary TO anon;

