require('dotenv').config();
const { Pool } = require('pg');

// Single shared connection pool, used everywhere via require('../db/pool')
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Most managed Postgres providers (Render, Railway, RDS, Supabase) require SSL.
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error', err);
});

module.exports = pool;
