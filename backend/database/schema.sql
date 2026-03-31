-- SEO Research Tool - Database Schema
-- Run this file to initialize the database:
--   mysql -u USER -p DATABASE_NAME < database/schema.sql
-- This file intentionally does not create or switch databases.
-- Run it against the database already created by your hosting provider.

-- --------------------------------------------------------
-- Tracked websites
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS websites (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  project_name VARCHAR(255) DEFAULT NULL,
  tags       JSON         DEFAULT NULL,
  archived   TINYINT(1)   NOT NULL DEFAULT 0,
  domain     VARCHAR(255) NOT NULL,
  target_url VARCHAR(2048) DEFAULT NULL,
  gsc_site_url VARCHAR(2048) DEFAULT NULL,
  country    CHAR(2)      NOT NULL DEFAULT 'US',
  is_active  TINYINT(1)   DEFAULT 1,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_website_domain (domain)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Tracked keywords
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS keywords (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  website_id    INT            DEFAULT NULL,
  keyword       VARCHAR(500)   NOT NULL,
  difficulty    DECIMAL(5,2)   DEFAULT NULL,
  search_volume INT            DEFAULT NULL,
  created_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_keywords_website (website_id),
  CONSTRAINT fk_keywords_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  UNIQUE KEY uq_website_keyword (website_id, keyword(255))
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Daily rank tracking
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS rankings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  website_id INT           DEFAULT NULL,
  keyword_id INT           NOT NULL,
  url        VARCHAR(2048) DEFAULT NULL,
  position   INT           DEFAULT NULL,
  title      VARCHAR(1000) DEFAULT NULL,
  date       DATE          NOT NULL,
  created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rankings_website (website_id),
  CONSTRAINT fk_rankings_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  CONSTRAINT fk_rankings_keyword FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
  UNIQUE KEY uq_website_keyword_date (website_id, keyword_id, date)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Cached SERP snapshots (avoid re-scraping within a window)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS serp_cache (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  keyword    VARCHAR(500)  NOT NULL,
  results    JSON          NOT NULL,
  fetched_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_keyword (keyword(255)),
  INDEX idx_fetched (fetched_at)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- SERP top results snapshots (Google + Bing)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS serp_results (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  website_id INT          DEFAULT NULL,
  query      VARCHAR(500) NOT NULL,
  country    CHAR(2)      NOT NULL DEFAULT 'US',
  engine     ENUM('google', 'bing') NOT NULL,
  position   INT          NOT NULL,
  url        VARCHAR(2048) NOT NULL,
  domain     VARCHAR(255) NOT NULL,
  title      VARCHAR(1000) DEFAULT NULL,
  snippet    TEXT          DEFAULT NULL,
  fetched_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_serp_results_scope (website_id, country, engine, fetched_at),
  INDEX idx_serp_results_query (query(255)),
  INDEX idx_serp_results_domain (domain),
  CONSTRAINT fk_serp_results_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Content analysis history
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_analyses (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  website_id    INT            DEFAULT NULL,
  url           VARCHAR(2048)  DEFAULT NULL,
  keyword       VARCHAR(500)   DEFAULT NULL,
  word_count    INT            DEFAULT NULL,
  seo_score     DECIMAL(5,2)   DEFAULT NULL,
  analysis_data JSON           DEFAULT NULL,
  created_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  KEY idx_content_analyses_website (website_id),
  CONSTRAINT fk_content_analyses_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Site audit history
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_audits (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  website_id  INT           DEFAULT NULL,
  url         VARCHAR(2048) NOT NULL,
  total_pages INT           DEFAULT NULL,
  audit_score DECIMAL(5,2)  DEFAULT NULL,
  result      JSON          NOT NULL,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  KEY idx_site_audits_website (website_id),
  CONSTRAINT fk_site_audits_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Normalized site issues for dashboard site health module
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS site_issues (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  website_id     INT DEFAULT NULL,
  site_audit_id  INT DEFAULT NULL,
  scope          ENUM('site', 'page') NOT NULL DEFAULT 'page',
  page_url       VARCHAR(2048) DEFAULT NULL,
  issue_key      VARCHAR(128) NOT NULL,
  issue_label    VARCHAR(255) NOT NULL,
  severity       ENUM('critical', 'high', 'medium', 'low') NOT NULL DEFAULT 'low',
  recommendation TEXT DEFAULT NULL,
  detected_at    DATETIME NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_site_issues_website (website_id),
  KEY idx_site_issues_audit (site_audit_id),
  KEY idx_site_issues_severity (severity),
  CONSTRAINT fk_site_issues_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  CONSTRAINT fk_site_issues_audit FOREIGN KEY (site_audit_id) REFERENCES site_audits(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Saved keyword research history
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS keyword_research_history (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  website_id        INT           DEFAULT NULL,
  keyword           VARCHAR(500)  NOT NULL,
  result            JSON          NOT NULL,
  total_suggestions INT           DEFAULT NULL,
  deep_scan         TINYINT(1)    DEFAULT 0,
  created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_keyword_history_website (website_id),
  INDEX idx_keyword_history_updated (keyword(255), updated_at),
  INDEX idx_keyword_history_created (created_at),
  CONSTRAINT fk_keyword_history_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Saved keyword lists
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS keyword_lists (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  website_id INT          DEFAULT NULL,
  name       VARCHAR(255) NOT NULL,
  items      JSON         NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_keyword_lists_website (website_id),
  CONSTRAINT fk_keyword_lists_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
  UNIQUE KEY uq_website_keyword_list_name (website_id, name)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Saved SERP analysis history
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS serp_analysis_history (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  website_id INT          DEFAULT NULL,
  keyword    VARCHAR(500) NOT NULL,
  country    CHAR(2)      NOT NULL DEFAULT 'US',
  result     JSON         NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_serp_history_website (website_id),
  INDEX idx_serp_history_lookup (keyword(255), country, updated_at),
  INDEX idx_serp_history_created (created_at),
  CONSTRAINT fk_serp_history_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- AI SERP run history (workspace + website scoped)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_serp_runs (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  website_id        INT           DEFAULT NULL,
  engine            ENUM('google','bing','llm') NOT NULL DEFAULT 'llm',
  search_domain     VARCHAR(64)   NOT NULL,
  country           CHAR(2)       NOT NULL DEFAULT 'US',
  location          VARCHAR(128)  DEFAULT NULL,
  keyword_count     INT           NOT NULL DEFAULT 0,
  total_citations   INT           NOT NULL DEFAULT 0,
  my_citations      INT           NOT NULL DEFAULT 0,
  average_best_rank DECIMAL(6,2)  DEFAULT NULL,
  result            JSON          DEFAULT NULL,
  created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ai_serp_runs_scope (website_id, country, created_at),
  CONSTRAINT fk_ai_serp_runs_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- AI SERP citations extracted per run
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_serp_mentions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  run_id           INT           NOT NULL,
  website_id       INT           DEFAULT NULL,
  provider_id      VARCHAR(64)   DEFAULT NULL,
  provider_name    VARCHAR(128)  DEFAULT NULL,
  provider_model   VARCHAR(128)  DEFAULT NULL,
  keyword          VARCHAR(500)  NOT NULL,
  result_position  INT           DEFAULT NULL,
  cited_title      VARCHAR(1000) DEFAULT NULL,
  cited_url        VARCHAR(2048) DEFAULT NULL,
  cited_domain     VARCHAR(255)  DEFAULT NULL,
  appears_on_site  TINYINT(1)    NOT NULL DEFAULT 0,
  fetched_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  created_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ai_serp_mentions_scope (website_id, keyword(255), fetched_at),
  INDEX idx_ai_serp_mentions_run (run_id),
  CONSTRAINT fk_ai_serp_mentions_run FOREIGN KEY (run_id) REFERENCES ai_serp_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_serp_mentions_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Saved Google Ads keyword research history
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_ads_keyword_history (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  website_id   INT           DEFAULT NULL,
  keyword      VARCHAR(500)  NOT NULL,
  country      CHAR(2)       NOT NULL DEFAULT 'US',
  country_name VARCHAR(128)  DEFAULT NULL,
  result       JSON          NOT NULL,
  total_ideas  INT           DEFAULT NULL,
  created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_google_ads_history_website (website_id),
  INDEX idx_google_ads_history_lookup (keyword(255), country, updated_at),
  INDEX idx_google_ads_history_created (created_at),
  CONSTRAINT fk_google_ads_history_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Rank tracker scheduler settings
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS rank_tracker_settings (
  id            TINYINT      NOT NULL PRIMARY KEY,
  schedule_time CHAR(5)      NOT NULL DEFAULT '06:00',
  search_depth  INT          NOT NULL DEFAULT 10,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- SERP provider on/off settings
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS serp_provider_settings (
  provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
  is_enabled  TINYINT(1)  NOT NULL DEFAULT 1,
  updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- SERP provider credentials saved from the app UI
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS serp_provider_credentials (
  provider_id       VARCHAR(64)  NOT NULL,
  credential_key    VARCHAR(128) NOT NULL,
  credential_value  TEXT         NOT NULL,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_id, credential_key)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- SERP provider request usage counters (remaining quota)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS serp_provider_usage (
  provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
  quota_limit INT         NOT NULL DEFAULT 0,
  remaining   INT         NOT NULL DEFAULT 0,
  used_count  INT         NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Backlink provider on/off settings
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS backlink_provider_settings (
  provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
  is_enabled  TINYINT(1)  NOT NULL DEFAULT 1,
  updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Backlink provider credentials saved from the app UI
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS backlink_provider_credentials (
  provider_id       VARCHAR(64)  NOT NULL,
  credential_key    VARCHAR(128) NOT NULL,
  credential_value  TEXT         NOT NULL,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_id, credential_key)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- AI provider on/off settings
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_provider_settings (
  provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
  is_enabled  TINYINT(1)  NOT NULL DEFAULT 1,
  updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- AI provider credentials saved from the app UI
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_provider_credentials (
  provider_id       VARCHAR(64)  NOT NULL,
  credential_key    VARCHAR(128) NOT NULL,
  credential_value  TEXT         NOT NULL,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_id, credential_key)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Google Search Console provider on/off settings
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS gsc_provider_settings (
  provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
  is_enabled  TINYINT(1)  NOT NULL DEFAULT 1,
  updated_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Google Search Console provider credentials saved from the app UI
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS gsc_provider_credentials (
  provider_id       VARCHAR(64)  NOT NULL,
  credential_key    VARCHAR(128) NOT NULL,
  credential_value  TEXT         NOT NULL,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (provider_id, credential_key)
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Organic traffic snapshots (website scoped)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS traffic_snapshots (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  website_id        INT          NOT NULL,
  metric_date       DATE         NOT NULL,
  estimated_traffic INT          NOT NULL DEFAULT 0,
  breakdown         JSON         DEFAULT NULL,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_traffic_snapshots_website_date (website_id, metric_date),
  CONSTRAINT fk_traffic_snapshots_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Backlink snapshots (website scoped)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS backlink_snapshots (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  website_id             INT          NOT NULL,
  snapshot_date          DATE         NOT NULL,
  backlinks_count        INT          NOT NULL DEFAULT 0,
  referring_domains_count INT         NOT NULL DEFAULT 0,
  result                 JSON         DEFAULT NULL,
  created_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_backlink_snapshots_website_date (website_id, snapshot_date),
  CONSTRAINT fk_backlink_snapshots_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- AI visibility modeled snapshots (website scoped)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  website_id  INT          DEFAULT NULL,
  country     CHAR(2)      NOT NULL DEFAULT 'US',
  metric_date DATE         NOT NULL,
  score       DECIMAL(5,2) NOT NULL DEFAULT 0,
  modeled     TINYINT(1)   NOT NULL DEFAULT 1,
  data_source VARCHAR(64)  NOT NULL DEFAULT 'proxy',
  breakdown   JSON         DEFAULT NULL,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ai_visibility_scope_date (website_id, country, metric_date),
  INDEX idx_ai_visibility_scope_date (website_id, country, metric_date),
  CONSTRAINT fk_ai_visibility_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
) ENGINE=InnoDB;
