const mysql = require('mysql2/promise');

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

module.exports = { pool, query, testConnection };
