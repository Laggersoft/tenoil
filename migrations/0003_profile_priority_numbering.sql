-- Migration 0003: Profile fields, priority, request numbering

-- Add phone, avatar, position fields to users
ALTER TABLE users ADD COLUMN phone TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT NULL;
ALTER TABLE users ADD COLUMN position TEXT DEFAULT NULL;

-- Update role constraint to include admin
-- (SQLite doesn't support ALTER TABLE to change CHECK, we just leave it - admin is already created via seed)

-- Add priority field to requests
ALTER TABLE requests ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent'));

-- Add request_number field (format: TEN-YYYY-NNNNNN)
ALTER TABLE requests ADD COLUMN request_number TEXT DEFAULT NULL;

-- Create index on priority
CREATE INDEX IF NOT EXISTS idx_requests_priority ON requests(priority);

-- Create index on request_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_number ON requests(request_number);

-- Backfill request_number for existing records
UPDATE requests SET request_number = 'TEN-' || strftime('%Y', created_at) || '-' || printf('%06d', id)
WHERE request_number IS NULL;
