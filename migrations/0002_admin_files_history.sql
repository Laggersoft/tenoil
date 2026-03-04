-- Migration 0002: Admin support, file storage, request history, projects

-- Add admin role to role check (retroactively update)
-- Add is_blocked to users
ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0;

-- Add project support
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add project_id to requests
ALTER TABLE requests ADD COLUMN project_id INTEGER REFERENCES projects(id);

-- Request files storage (base64 in SQLite)
CREATE TABLE IF NOT EXISTS request_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  file_data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES requests(id),
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- Request status change history / audit log
CREATE TABLE IF NOT EXISTS request_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  changed_by INTEGER NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES requests(id),
  FOREIGN KEY (changed_by) REFERENCES users(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_request_files_request_id ON request_files(request_id);
CREATE INDEX IF NOT EXISTS idx_request_history_request_id ON request_status_history(request_id);
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
