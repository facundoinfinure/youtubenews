-- Add publication_date column to news_items table
-- This stores the actual publication date of each news article
-- as opposed to news_date which is the date selected by the user

ALTER TABLE news_items 
ADD COLUMN IF NOT EXISTS publication_date date;

-- Create index for faster publication date lookups
CREATE INDEX IF NOT EXISTS idx_news_publication_date ON news_items(publication_date);

-- Update existing records: set publication_date = news_date for existing records
-- This ensures backward compatibility
UPDATE news_items 
SET publication_date = news_date 
WHERE publication_date IS NULL;
