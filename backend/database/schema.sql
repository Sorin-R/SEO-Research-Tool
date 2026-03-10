-- SEO Research Tool - Database Schema
-- Run this file to initialize the database:
--   mysql -u USER -p DATABASE_NAME < database/schema.sql
-- This file intentionally does not create or switch databases.
-- Run it against the database already created by your hosting provider.

-- --------------------------------------------------------
-- Tracked keywords
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS keywords (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  keyword       VARCHAR(500)   NOT NULL,
  difficulty    DECIMAL(5,2)   DEFAULT NULL,
  search_volume INT            DEFAULT NULL,
  created_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_keyword (keyword(255))
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Daily rank tracking
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS rankings (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  keyword_id INT          NOT NULL,
  url        VARCHAR(2048) DEFAULT NULL,
  position   INT          DEFAULT NULL,
  title      VARCHAR(1000) DEFAULT NULL,
  date       DATE         NOT NULL,
  created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
  UNIQUE KEY uq_keyword_date (keyword_id, date)
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
-- Content analysis history
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_analyses (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  url           VARCHAR(2048)  DEFAULT NULL,
  keyword       VARCHAR(500)   DEFAULT NULL,
  word_count    INT            DEFAULT NULL,
  seo_score     DECIMAL(5,2)   DEFAULT NULL,
  analysis_data JSON           DEFAULT NULL,
  created_at    TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- --------------------------------------------------------
-- Saved keyword research history
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS keyword_research_history (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  keyword           VARCHAR(500)  NOT NULL,
  result            JSON          NOT NULL,
  total_suggestions INT           DEFAULT NULL,
  deep_scan         TINYINT(1)    DEFAULT 0,
  created_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_keyword_history_updated (keyword(255), updated_at),
  INDEX idx_keyword_history_created (created_at)
) ENGINE=InnoDB;
