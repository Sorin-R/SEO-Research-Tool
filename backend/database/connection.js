const mysql = require('mysql2/promise');

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS websites (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
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
    keyword VARCHAR(500) NOT NULL,
    difficulty DECIMAL(5,2) DEFAULT NULL,
    search_volume INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_keyword (keyword(255))
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
  `CREATE TABLE IF NOT EXISTS content_analyses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    url VARCHAR(2048) DEFAULT NULL,
    keyword VARCHAR(500) DEFAULT NULL,
    word_count INT DEFAULT NULL,
    seo_score DECIMAL(5,2) DEFAULT NULL,
    analysis_data JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS keyword_research_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(500) NOT NULL,
    result JSON NOT NULL,
    total_suggestions INT DEFAULT NULL,
    deep_scan TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_keyword_history_updated (keyword(255), updated_at),
    INDEX idx_keyword_history_created (created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS serp_analysis_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    keyword VARCHAR(500) NOT NULL,
    country CHAR(2) NOT NULL DEFAULT 'US',
    result JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_serp_history_lookup (keyword(255), country, updated_at),
    INDEX idx_serp_history_created (created_at)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS rank_tracker_settings (
    id TINYINT NOT NULL PRIMARY KEY,
    schedule_time CHAR(5) NOT NULL DEFAULT '06:00',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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

  await ensureWebsitesTargetUrlSchema();
  await ensureWebsitesCountrySchema();
  await ensureRankingsWebsiteSchema();

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

  if (await hasIndex('rankings', 'uq_keyword_date')) {
    await pool.query('ALTER TABLE rankings DROP INDEX uq_keyword_date');
  }

  if (!(await hasIndex('rankings', 'uq_website_keyword_date'))) {
    await pool.query(
      'ALTER TABLE rankings ADD UNIQUE KEY uq_website_keyword_date (website_id, keyword_id, date)'
    );
  }

  if (!(await hasConstraint('rankings', 'fk_rankings_website'))) {
    await pool.query(
      'ALTER TABLE rankings ADD CONSTRAINT fk_rankings_website FOREIGN KEY (website_id) REFERENCES websites(id) ON DELETE CASCADE'
    );
  }
}

async function ensureWebsitesCountrySchema() {
  if (!(await hasColumn('websites', 'country'))) {
    await pool.query(`ALTER TABLE websites ADD COLUMN country CHAR(2) NOT NULL DEFAULT 'US' AFTER domain`);
  }

  await pool.query(`UPDATE websites SET country = 'US' WHERE country IS NULL OR country = ''`);
}

async function ensureWebsitesTargetUrlSchema() {
  if (!(await hasColumn('websites', 'target_url'))) {
    await pool.query('ALTER TABLE websites ADD COLUMN target_url VARCHAR(2048) DEFAULT NULL AFTER domain');
  }
}

module.exports = { pool, query, testConnection, ensureSchema };
