-- Seed demo users
-- password123 SHA-256: ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f

-- Admin user (admin / admin123)
INSERT OR IGNORE INTO users (username, email, password_hash, role, full_name, is_blocked)
VALUES ('admin', 'admin@tenoil.kz', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'admin', 'Администратор системы', 0);

-- Applicants
INSERT OR IGNORE INTO users (username, email, password_hash, role, full_name, is_blocked) VALUES
  ('applicant1', 'applicant1@example.com', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'applicant', 'Иван Петров', 0),
  ('applicant2', 'applicant2@example.com', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'applicant', 'Мария Сидорова', 0);

-- Suppliers
INSERT OR IGNORE INTO users (username, email, password_hash, role, full_name, is_blocked) VALUES
  ('supplier1', 'supplier1@example.com', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'supplier', 'Алексей Снабженцев', 0);

-- Projects
INSERT OR IGNORE INTO projects (name, description) VALUES
  ('KSU', 'KSU'),
  ('3GP', '3GP'),
  ('HVAC', 'HVAC'),
  ('ALL', 'ALL'),
  ('Office', 'Office'),
  ('SICIM', 'SICIM'),
  ('3GI', '3GI'),
  ('NAO', 'NAO'),
  ('FL-HL', 'FLHL');

