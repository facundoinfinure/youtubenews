-- Migration: Add versioning fields to productions table
-- Run this after the main schema is created

-- Add version column (default 1 for existing rows)
alter table productions add column if not exists version integer default 1;

-- Add parent_production_id column
alter table productions add column if not exists parent_production_id uuid references productions(id) on delete set null;

-- Create index for parent_production_id
create index if not exists idx_productions_parent on productions(parent_production_id);
