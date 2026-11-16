-- Plyleaf usage counter: daily totals only.
-- Apply once: npx wrangler d1 execute plyleaf-stats --remote --file functions/schema.sql
CREATE TABLE IF NOT EXISTS counts (
  day  TEXT NOT NULL,           -- YYYY-MM-DD, UTC
  kind TEXT NOT NULL,           -- view | done
  tool TEXT NOT NULL,           -- page slug, e.g. pdf-booklet
  lang TEXT NOT NULL,           -- language prefix of the page, en for none
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, tool, lang)
);
