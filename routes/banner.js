const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /banner_messages
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM public.banner_messages WHERE is_active = true ORDER BY priority DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
