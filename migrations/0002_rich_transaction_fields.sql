-- Additive migration for accounting and bank statement import metadata.
ALTER TABLE transactions ADD COLUMN category_source TEXT NOT NULL DEFAULT 'provided' CHECK (category_source IN ('provided', 'inferred'));
ALTER TABLE transactions ADD COLUMN account_name TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN account_code TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN counterparty TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN cost_center TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN document_number TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN due_date TEXT;
ALTER TABLE transactions ADD COLUMN payment_date TEXT;
ALTER TABLE transactions ADD COLUMN payment_method TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT '';
ALTER TABLE transactions ADD COLUMN notes TEXT NOT NULL DEFAULT '';
