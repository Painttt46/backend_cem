import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost', 
  database: process.env.DB_NAME || 'SOCC',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
  
  // Pool configuration
  max: 20,                      // Maximum number of clients
  min: 5,                       // Minimum number of clients
  idleTimeoutMillis: 30000,     // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection not available
  maxUses: 7500,                // Close connection after 7500 uses
});

// Handle pool errors
pool.on('error', (err, client) => {
  console.error('Unexpected database pool error:', err);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  pool.end(() => {
    console.log('Database pool closed');
    process.exit(0);
  });
});

export default pool;
