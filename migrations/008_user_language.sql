-- TASK 39 FIX 3: Add user language preference
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en'
  CHECK (language IN ('en', 'ru', 'id'));

UPDATE users SET language = 'en' WHERE language IS NULL;
