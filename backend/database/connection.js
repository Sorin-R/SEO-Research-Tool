const mysql = require('mysql2/promise');

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS websites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    project_name VARCHAR(255) DEFAULT NULL,
    tags JSON DEFAULT NULL,
    archived TINYINT(1) NOT NULL DEFAULT 0,
    domain VARCHAR(255) NOT NULL,
    target_url VARCHAR(2048) DEFAULT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_website_domain (domain)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS keywords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    keyword VARCHAR(500) NOT NULL,
    difficulty DECIMAL(5,2) DEFAULT NULL,
    search_volume INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_keywords_website (website_id),
    CONSTRAINT fk_keywords_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
    UNIQUE KEY uq_website_keyword (website_id, keyword(255))
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS rankings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    keyword_id INT NOT NULL,
    url VARCHAR(2048) DEFAULT NULL,
    position INT DEFAULT NULL,
    title VARCHAR(1000) DEFAULT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_rankings_website (website_id),
    CONSTRAINT fk_rankings_keyword FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
    CONSTRAINT fk_rankings_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
    UNIQUE KEY uq_website_keyword_date (website_id, keyword_id, date)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS serp_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(500) NOT NULL,
    results JSON NOT NULL,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_keyword (keyword(255)),
    INDEX idx_fetched (fetched_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS serp_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    query VARCHAR(500) NOT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    engine ENUM('google', 'bing') NOT NULL,
    position INT NOT NULL,
    url VARCHAR(2048) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    title VARCHAR(1000) DEFAULT NULL,
    snippet TEXT DEFAULT NULL,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_serp_results_scope (website_id, country, engine, fetched_at),
    INDEX idx_serp_results_query (query(255)),
    INDEX idx_serp_results_domain (domain),
    CONSTRAINT fk_serp_results_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS content_analyses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    url VARCHAR(2048) DEFAULT NULL,
    keyword VARCHAR(500) DEFAULT NULL,
    word_count INT DEFAULT NULL,
    seo_score DECIMAL(5,2) DEFAULT NULL,
    analysis_data JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_content_analyses_website (website_id),
    CONSTRAINT fk_content_analyses_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS site_audits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    url VARCHAR(2048) NOT NULL,
    total_pages INT DEFAULT NULL,
    audit_score DECIMAL(5,2) DEFAULT NULL,
    result JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_site_audits_website (website_id),
    CONSTRAINT fk_site_audits_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS keyword_research_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    keyword VARCHAR(500) NOT NULL,
    result JSON NOT NULL,
    total_suggestions INT DEFAULT NULL,
    deep_scan TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_keyword_history_website (website_id),
    INDEX idx_keyword_history_updated (keyword(255), updated_at),
    INDEX idx_keyword_history_created (created_at),
    CONSTRAINT fk_keyword_history_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS keyword_lists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    name VARCHAR(255) NOT NULL,
    items JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_keyword_lists_website (website_id),
    CONSTRAINT fk_keyword_lists_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE,
    UNIQUE KEY uq_website_keyword_list_name (website_id, name)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS serp_analysis_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    keyword VARCHAR(500) NOT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    result JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_serp_history_website (website_id),
    INDEX idx_serp_history_lookup (keyword(255), country, updated_at),
    INDEX idx_serp_history_created (created_at),
    CONSTRAINT fk_serp_history_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS google_ads_keyword_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    keyword VARCHAR(500) NOT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    country_name VARCHAR(128) DEFAULT NULL,
    result JSON NOT NULL,
    total_ideas INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_google_ads_history_website (website_id),
    INDEX idx_google_ads_history_lookup (keyword(255), country, updated_at),
    INDEX idx_google_ads_history_created (created_at),
    CONSTRAINT fk_google_ads_history_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS rank_tracker_settings (
    id TINYINT NOT NULL PRIMARY KEY,
    schedule_time CHAR(5) NOT NULL DEFAULT '06:00',
    search_depth INT NOT NULL DEFAULT 10,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS serp_provider_settings (
    provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS serp_provider_credentials (
    provider_id VARCHAR(64) NOT NULL,
    credential_key VARCHAR(128) NOT NULL,
    credential_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (provider_id, credential_key)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS serp_provider_usage (
    provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
    quota_limit INT NOT NULL DEFAULT 0,
    remaining INT NOT NULL DEFAULT 0,
    used_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ai_provider_settings (
    provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ai_provider_credentials (
    provider_id VARCHAR(64) NOT NULL,
    credential_key VARCHAR(128) NOT NULL,
    credential_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (provider_id, credential_key)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS gsc_provider_settings (
    provider_id VARCHAR(64) NOT NULL PRIMARY KEY,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS gsc_provider_credentials (
    provider_id VARCHAR(64) NOT NULL,
    credential_key VARCHAR(128) NOT NULL,
    credential_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (provider_id, credential_key)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS rank_tracker_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source VARCHAR(32) NOT NULL DEFAULT 'Cron',
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    processed_keywords INT NOT NULL DEFAULT 0,
    processed_websites INT NOT NULL DEFAULT 0,
    updated_count INT NOT NULL DEFAULT 0,
    matched_count INT NOT NULL DEFAULT 0,
    failed_count INT NOT NULL DEFAULT 0,
    error_message TEXT DEFAULT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP NULL DEFAULT NULL,
    INDEX idx_jobs_started (started_at),
    INDEX idx_jobs_status (status)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ranking_alerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    keyword_id INT NOT NULL,
    website_id INT NULL,
    alert_type VARCHAR(32) NOT NULL,
    old_position INT DEFAULT NULL,
    new_position INT DEFAULT NULL,
    message TEXT NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_alerts_read (is_read, created_at),
    CONSTRAINT fk_alerts_keyword FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
    CONSTRAINT fk_alerts_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS traffic_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NOT NULL,
    metric_date DATE NOT NULL,
    estimated_traffic INT NOT NULL DEFAULT 0,
    breakdown JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_traffic_snapshots_website_date (website_id, metric_date),
    CONSTRAINT fk_traffic_snapshots_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS backlink_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NOT NULL,
    snapshot_date DATE NOT NULL,
    backlinks_count INT NOT NULL DEFAULT 0,
    referring_domains_count INT NOT NULL DEFAULT 0,
    result JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_backlink_snapshots_website_date (website_id, snapshot_date),
    CONSTRAINT fk_backlink_snapshots_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ai_visibility_snapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    website_id INT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    metric_date DATE NOT NULL,
    score DECIMAL(5,2) NOT NULL DEFAULT 0,
    modeled TINYINT(1) NOT NULL DEFAULT 1,
    data_source VARCHAR(64) NOT NULL DEFAULT 'proxy',
    breakdown JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ai_visibility_scope_date (website_id, country, metric_date),
    INDEX idx_ai_visibility_scope_date (website_id, country, metric_date),
    CONSTRAINT fk_ai_visibility_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`,
];

/**
 * MySQL connection pool.
 * Uses a pool to efficiently manage multiple concurrent connections.
 */
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'seo_tool',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Execute a parameterized query against the pool.
 * @param {string} sql - SQL statement with ? placeholders
 * @param {Array}  params - Values to bind
 * @returns {Promise<Array>} rows
 */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Test the database connection on startup.
 */
async function testConnection() {
  try {
    await pool.query('SELECT 1');
    console.log('[DB] MySQL connection established.');
  } catch (err) {
    console.error('[DB] MySQL connection failed:', err.message);
    throw err;
  }
}

/**
 * Ensure the connected database contains the tables the app expects.
 * This keeps first-time deployments working on providers like Hostinger.
 */
async function ensureSchema() {
  for (const statement of schemaStatements) {
    await pool.query(statement);
  }

  await ensureWebsitesMetadataSchema();
  await ensureWebsitesTargetUrlSchema();
  await ensureWebsitesCountrySchema();
  await ensureKeywordWebsiteSchema();
  await ensureRankingsWebsiteSchema();
  await ensureWebsiteScopedHistorySchema();
  await ensureRankTrackerSettingsSchema();
  await ensureSerpProviderSettingsSchema();
  await ensureSerpProviderCredentialsSchema();
  await ensureRankingsDateIndex();
  await cleanupOldSerpCache();

  console.log('[DB] Schema verified.');
}

async function hasColumn(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function hasIndex(tableName, indexName) {
  const [rows] = await pool.query(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );

  return rows.length > 0;
}

async function getUniqueIndexes(tableName) {
  const [rows] = await pool.query(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND NON_UNIQUE = 0`,
    [tableName]
  );

  return [...new Set(rows.map((row) => row.INDEX_NAME))];
}

async function hasConstraint(tableName, constraintName) {
  const [rows] = await pool.query(
    `SELECT CONSTRAINT_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
     LIMIT 1`,
    [tableName, constraintName]
  );

  return rows.length > 0;
}

async function ensureRankingsWebsiteSchema() {
  if (!(await hasColumn('rankings', 'website_id'))) {
    await pool.query('ALTER TABLE rankings ADD COLUMN website_id INT NULL AFTER keyword_id');
  }

  if (!(await hasIndex('rankings', 'idx_rankings_website'))) {
    await pool.query('ALTER TABLE rankings ADD INDEX idx_rankings_website (website_id)');
  }

  const uniqueIndexes = await getUniqueIndexes('rankings');

  for (const indexName of uniqueIndexes) {
    if (indexName === 'PRIMARY' || indexName === 'uq_website_keyword_date') {
      continue;
    }

    await pool.query(`ALTER TABLE rankings DROP INDEX ${indexName}`);
  }

  if (!(await hasIndex('rankings', 'uq_website_keyword_date'))) {
    await pool.query(
      'ALTER TABLE rankings ADD UNIQUE KEY uq_website_keyword_date (website_id, keyword_id, date)'
    );
  }

  await clearOrphanedRankingWebsiteIds();

  if (!(await hasConstraint('rankings', 'fk_rankings_website'))) {
    await pool.query(
      'ALTER TABLE rankings ADD CONSTRAINT fk_rankings_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE'
    );
  }
}

async function clearOrphanedRankingWebsiteIds() {
  await pool.query(
    `UPDATE rankings r
     LEFT JOIN websites w ON w.id = r.website_id
     SET r.website_id = NULL
     WHERE r.website_id IS NOT NULL
       AND w.id IS NULL`
  );
}

async function ensureWebsitesCountrySchema() {
  if (!(await hasColumn('websites', 'country'))) {
    await pool.query(`ALTER TABLE websites ADD COLUMN country CHAR(2) NOT NULL DEFAULT 'US' AFTER domain`);
  }

  await pool.query(`UPDATE websites SET country = 'US' WHERE country IS NULL OR country = ''`);
}

async function ensureWebsitesMetadataSchema() {
  if (!(await hasColumn('websites', 'project_name'))) {
    await pool.query('ALTER TABLE websites ADD COLUMN project_name VARCHAR(255) DEFAULT NULL AFTER name');
  }

  if (!(await hasColumn('websites', 'tags'))) {
    await pool.query('ALTER TABLE websites ADD COLUMN tags JSON DEFAULT NULL AFTER project_name');
  }

  if (!(await hasColumn('websites', 'archived'))) {
    await pool.query('ALTER TABLE websites ADD COLUMN archived TINYINT(1) NOT NULL DEFAULT 0 AFTER tags');
  }

  await pool.query('UPDATE websites SET project_name = COALESCE(project_name, name) WHERE project_name IS NULL OR project_name = ""');
}

async function ensureWebsitesTargetUrlSchema() {
  if (!(await hasColumn('websites', 'target_url'))) {
    await pool.query('ALTER TABLE websites ADD COLUMN target_url VARCHAR(2048) DEFAULT NULL AFTER domain');
  }
}

async function ensureKeywordWebsiteSchema() {
  if (!(await hasColumn('keywords', 'website_id'))) {
    await pool.query('ALTER TABLE keywords ADD COLUMN website_id INT NULL AFTER id');
  }

  if (!(await hasIndex('keywords', 'idx_keywords_website'))) {
    await pool.query('ALTER TABLE keywords ADD INDEX idx_keywords_website (website_id)');
  }

  if (!(await hasConstraint('keywords', 'fk_keywords_website'))) {
    await pool.query(
      'ALTER TABLE keywords ADD CONSTRAINT fk_keywords_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE'
    );
  }

  if (await hasIndex('keywords', 'uq_keyword')) {
    await pool.query('ALTER TABLE keywords DROP INDEX uq_keyword');
  }

  if (!(await hasIndex('keywords', 'uq_website_keyword'))) {
    await pool.query('ALTER TABLE keywords ADD UNIQUE KEY uq_website_keyword (website_id, keyword(255))');
  }
}

async function ensureWebsiteScopedHistorySchema() {
  const scopedTables = [
    {
      table: 'content_analyses',
      index: 'idx_content_analyses_website',
      constraint: 'fk_content_analyses_website',
      columnPosition: 'AFTER id',
    },
    {
      table: 'site_audits',
      index: 'idx_site_audits_website',
      constraint: 'fk_site_audits_website',
      columnPosition: 'AFTER id',
    },
    {
      table: 'keyword_research_history',
      index: 'idx_keyword_history_website',
      constraint: 'fk_keyword_history_website',
      columnPosition: 'AFTER id',
    },
    {
      table: 'keyword_lists',
      index: 'idx_keyword_lists_website',
      constraint: 'fk_keyword_lists_website',
      columnPosition: 'AFTER id',
    },
    {
      table: 'serp_analysis_history',
      index: 'idx_serp_history_website',
      constraint: 'fk_serp_history_website',
      columnPosition: 'AFTER id',
    },
    {
      table: 'google_ads_keyword_history',
      index: 'idx_google_ads_history_website',
      constraint: 'fk_google_ads_history_website',
      columnPosition: 'AFTER id',
    },
  ];

  for (const entry of scopedTables) {
    if (!(await hasColumn(entry.table, 'website_id'))) {
      await pool.query(`ALTER TABLE ${entry.table} ADD COLUMN website_id INT NULL ${entry.columnPosition}`);
    }

    if (!(await hasIndex(entry.table, entry.index))) {
      await pool.query(`ALTER TABLE ${entry.table} ADD INDEX ${entry.index} (website_id)`);
    }

    if (!(await hasConstraint(entry.table, entry.constraint))) {
      await pool.query(
        `ALTER TABLE ${entry.table} ADD CONSTRAINT ${entry.constraint} FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE`
      );
    }
  }

  if (await hasIndex('keyword_lists', 'uq_keyword_list_name')) {
    await pool.query('ALTER TABLE keyword_lists DROP INDEX uq_keyword_list_name');
  }

  if (!(await hasIndex('keyword_lists', 'uq_website_keyword_list_name'))) {
    await pool.query('ALTER TABLE keyword_lists ADD UNIQUE KEY uq_website_keyword_list_name (website_id, name)');
  }
}

async function ensureRankTrackerSettingsSchema() {
  if (!(await hasColumn('rank_tracker_settings', 'search_depth'))) {
    await pool.query(
      'ALTER TABLE rank_tracker_settings ADD COLUMN search_depth INT NOT NULL DEFAULT 10 AFTER schedule_time'
    );
  }

  await pool.query(
    `UPDATE rank_tracker_settings
     SET search_depth = 10
     WHERE search_depth IS NULL OR search_depth NOT IN (10, 20, 50, 100)`
  );
}

async function ensureSerpProviderSettingsSchema() {
  if (!(await hasColumn('serp_provider_settings', 'provider_id'))) {
    return;
  }

  if (!(await hasColumn('serp_provider_settings', 'is_enabled'))) {
    await pool.query(
      'ALTER TABLE serp_provider_settings ADD COLUMN is_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER provider_id'
    );
  }
}

async function ensureSerpProviderCredentialsSchema() {
  if (!(await hasColumn('serp_provider_credentials', 'provider_id'))) {
    return;
  }

  if (!(await hasColumn('serp_provider_credentials', 'credential_key'))) {
    await pool.query(
      'ALTER TABLE serp_provider_credentials ADD COLUMN credential_key VARCHAR(128) NOT NULL AFTER provider_id'
    );
  }

  if (!(await hasColumn('serp_provider_credentials', 'credential_value'))) {
    await pool.query(
      'ALTER TABLE serp_provider_credentials ADD COLUMN credential_value TEXT NOT NULL AFTER credential_key'
    );
  }
}

async function ensureRankingsDateIndex() {
  if (!(await hasIndex('rankings', 'idx_rankings_keyword_date'))) {
    await pool.query(
      'ALTER TABLE rankings ADD INDEX idx_rankings_keyword_date (keyword_id, date)'
    );
  }
}

async function cleanupOldSerpCache() {
  try {
    await pool.query(
      `DELETE FROM serp_cache WHERE fetched_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
  } catch {
    // non-critical
  }
}

module.exports = {
  pool,
  query,
  testConnection,
  ensureSchema,
  ensureRankingsWebsiteSchema,
};
