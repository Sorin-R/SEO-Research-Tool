const mysql = require('mysql2/promise');

const schemaStatements = [
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
    keyword_id INT NOT NULL,
    url VARCHAR(2048) DEFAULT NULL,
    position INT DEFAULT NULL,
    title VARCHAR(1000) DEFAULT NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
    UNIQUE KEY uq_keyword_date (keyword_id, date)
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

  console.log('[DB] Schema verified.');
}

module.exports = { pool, query, testConnection, ensureSchema };
