-- Preserve the movement date and accounting competence date separately.
ALTER TABLE transactions ADD COLUMN competence_date TEXT;
