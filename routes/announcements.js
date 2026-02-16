import express from 'express'
import pool from '../config/database.js'

const router = express.Router()

async function ensureAnnouncementsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      author_name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_by INTEGER,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await pool.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`)
  await pool.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`)
}

// Get latest active announcement
router.get('/active', async (req, res) => {
  try {
    await ensureAnnouncementsTable()

    const result = await pool.query(`
      SELECT id, author_name, message, created_by, is_active, created_at
      FROM announcements
      WHERE is_active = TRUE
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)

    res.json(result.rows[0] || null)
  } catch (error) {
    console.error('Error fetching active announcement:', error)
    res.status(500).json({ error: error.message })
  }
})

// Create new announcement (deactivate previous ones)
router.post('/', async (req, res) => {
  try {
    await ensureAnnouncementsTable()

    const { author_name, message } = req.body || {}
    if (!author_name || !String(author_name).trim()) {
      return res.status(400).json({ error: 'author_name is required' })
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'message is required' })
    }

    const createdBy = req.user?.id || null

    await pool.query(`UPDATE announcements SET is_active = FALSE WHERE is_active = TRUE`)

    const insertResult = await pool.query(
      `INSERT INTO announcements (author_name, message, created_by, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id, author_name, message, created_by, is_active, created_at`,
      [String(author_name).trim(), String(message).trim(), createdBy]
    )

    res.status(201).json(insertResult.rows[0])
  } catch (error) {
    console.error('Error creating announcement:', error)
    res.status(500).json({ error: error.message })
  }
})

// Deactivate current active announcement
router.post('/deactivate', async (req, res) => {
  try {
    await ensureAnnouncementsTable()

    await pool.query(`UPDATE announcements SET is_active = FALSE WHERE is_active = TRUE`)
    res.json({ success: true })
  } catch (error) {
    console.error('Error deactivating announcement:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
