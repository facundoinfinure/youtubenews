-- =============================================================================================
-- FIX STORAGE POLICIES FOR AUDIO UPLOADS
-- =============================================================================================
-- This script fixes the "row-level security policy" error when uploading audio files
-- to the channel-assets bucket via serverless functions.
--
-- The issue: Storage operations use the storage.objects table which has RLS enabled.
-- We need to allow service role key and authenticated users to upload files.
--
-- Run this SQL in your Supabase SQL Editor after ensuring the 'channel-assets' bucket exists.
-- =============================================================================================

-- Drop existing policies if they exist (optional, for clean slate)
-- Uncomment these lines if you want to recreate the policies from scratch:
-- DROP POLICY IF EXISTS "Allow service role uploads" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow service role updates" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow service role deletes" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow public reads" ON storage.objects;

-- IMPORTANT: PostgreSQL doesn't support IF NOT EXISTS for CREATE POLICY.
-- If a policy already exists, you'll get an error. Either:
-- 1. Drop existing policies first (uncomment DROP statements above), OR
-- 2. Check if policies exist before creating them, OR
-- 3. Ignore errors if policies already exist

-- Allow service role key to upload files (for serverless functions)
-- This uses auth.jwt() - when service role key is used, auth.role() returns 'service_role'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Allow service role uploads'
  ) THEN
    CREATE POLICY "Allow service role uploads" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'channel-assets' AND
        (auth.role() = 'service_role')
      );
  END IF;
END $$;

-- Allow service role key to update files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Allow service role updates'
  ) THEN
    CREATE POLICY "Allow service role updates" ON storage.objects
      FOR UPDATE USING (
        bucket_id = 'channel-assets' AND
        (auth.role() = 'service_role')
      );
  END IF;
END $$;

-- Allow service role key to delete files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Allow service role deletes'
  ) THEN
    CREATE POLICY "Allow service role deletes" ON storage.objects
      FOR DELETE USING (
        bucket_id = 'channel-assets' AND
        (auth.role() = 'service_role')
      );
  END IF;
END $$;

-- Allow authenticated users to upload files (if you want user uploads too)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Allow authenticated uploads'
  ) THEN
    CREATE POLICY "Allow authenticated uploads" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'channel-assets' AND
        auth.role() = 'authenticated'
      );
  END IF;
END $$;

-- Allow public read access (since bucket is public)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
    AND tablename = 'objects' 
    AND policyname = 'Allow public reads'
  ) THEN
    CREATE POLICY "Allow public reads" ON storage.objects
      FOR SELECT USING (bucket_id = 'channel-assets');
  END IF;
END $$;

-- =============================================================================================
-- VERIFICATION
-- =============================================================================================
-- After running this script, verify the policies exist:
-- SELECT * FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';
--
-- Expected policies:
-- - Allow service role uploads
-- - Allow service role updates  
-- - Allow service role deletes
-- - Allow authenticated uploads (optional)
-- - Allow public reads
-- =============================================================================================
