-- Schema for `health_ssot` database.
-- Mirrors the normalized SSoT (`data/health_log.normalized.json`) which is
-- itself derived from `health_log.md`. Populated by sync_ssot_to_mysql.js.
--
-- Key design choices:
--  * `entry_key` (sha256 of immutable identity) is the primary key, matching
--    sync_state.json semantics. This makes upserts idempotent across edits.
--  * Edits to title/carbs/etc. update the same row; `content_hash` tracks the
--    latest version, `last_synced_at` records when we last saw a change.
--  * Soft deletes via `deleted_at` — if an entry disappears from health_log.md
--    we mark it instead of dropping it, so the table is a true historical
--    record (this is what saves us from runaway-archival incidents).
--  * Predictions are stored both as raw text (as written in the log) and
--    parsed numeric ranges where the format is recognizable.

CREATE DATABASE IF NOT EXISTS health_ssot
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

USE health_ssot;

CREATE TABLE IF NOT EXISTS health_log_entries (
  -- Identity
  entry_key            VARCHAR(80)  NOT NULL,
  content_hash         VARCHAR(80)  NOT NULL,
  ts_iso               VARCHAR(40)  NOT NULL,
  event_date           DATE         NOT NULL,
  event_time           VARCHAR(20)  NOT NULL,
  tz_offset            VARCHAR(10)  NOT NULL,
  user_name            VARCHAR(60)  NOT NULL,

  -- Classification
  category             ENUM('Food','Medication','Activity','Exercise','Sleep','Note') NOT NULL,
  meal_type            VARCHAR(20)  DEFAULT NULL,

  -- Content
  title                TEXT         NOT NULL,
  notes                TEXT,
  photo_urls           JSON,
  -- Denormalized first photo URL — 99% of entries have ≤1 photo, and querying
  -- JSON columns is awkward (`JSON_EXTRACT(photo_urls, '$[0]')`). Kept in sync
  -- with photo_urls[0] by sync_ssot_to_mysql.js.
  primary_photo_url    VARCHAR(500) DEFAULT NULL,

  -- Nutrition
  carbs_est            INT          DEFAULT NULL,
  calories_est         INT          DEFAULT NULL,
  protein_est          DECIMAL(5,1) DEFAULT NULL,

  -- Predictions (raw + parsed)
  predicted_peak_bg_text   VARCHAR(120) DEFAULT NULL,
  predicted_peak_time_text VARCHAR(120) DEFAULT NULL,
  predicted_peak_bg_low    INT         DEFAULT NULL,
  predicted_peak_bg_high   INT         DEFAULT NULL,

  -- Actual outcomes (backfilled ~3h after the entry)
  pre_meal_bg          INT      DEFAULT NULL,
  peak_bg              INT      DEFAULT NULL,
  two_hour_peak_bg     INT      DEFAULT NULL,
  peak_time            DATETIME DEFAULT NULL,
  bg_delta             INT      DEFAULT NULL,
  time_to_peak_min     INT      DEFAULT NULL,
  peak_bg_delta        INT      DEFAULT NULL,
  peak_time_delta_min  INT      DEFAULT NULL,

  -- Sync state snapshot (informational; sync_state.json remains the source)
  sync_ns              VARCHAR(20) DEFAULT NULL,
  sync_notion          VARCHAR(20) DEFAULT NULL,
  sync_gallery         VARCHAR(20) DEFAULT NULL,
  outcomes_backfilled  TINYINT(1)  DEFAULT 0,

  -- Provenance — so a row can be traced back to the SSoT line
  source_file          VARCHAR(120) DEFAULT NULL,
  source_line          INT          DEFAULT NULL,
  raw_row              TEXT,

  -- Bookkeeping
  first_seen_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  last_synced_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMP    NULL DEFAULT NULL,

  PRIMARY KEY (entry_key),
  KEY idx_event_date    (event_date),
  KEY idx_cat_date      (category, event_date),
  KEY idx_user_date     (user_name, event_date),
  KEY idx_meal_type     (meal_type),
  KEY idx_content_hash  (content_hash),
  KEY idx_deleted_at    (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sync run log: one row per sync_ssot_to_mysql.js execution.
CREATE TABLE IF NOT EXISTS sync_runs (
  id           INT          NOT NULL AUTO_INCREMENT,
  started_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  TIMESTAMP    NULL,
  ssot_entries INT          DEFAULT NULL,
  inserted     INT          DEFAULT NULL,
  updated      INT          DEFAULT NULL,
  unchanged    INT          DEFAULT NULL,
  soft_deleted INT          DEFAULT NULL,
  status       VARCHAR(20)  DEFAULT NULL,
  error        TEXT,
  PRIMARY KEY (id),
  KEY idx_started_at (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
