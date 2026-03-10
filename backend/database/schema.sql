-- SEO Research Tool - Database Schema
-- Run this file to initialize the database:
--   mysql -u root -p < database/schema.sql

CREATE DATABASE IF NOT EXISTS seo_tool
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE seo_tool;

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
