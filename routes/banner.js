import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../config/database.js';

const router = express.Router();

// Setup banner uploads directory
const bannerUploadDir = './uploads/banner';
if (!fs.existsSync(bannerUploadDir)) {
  fs.mkdirSync(bannerUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, bannerUploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype.split('/')[1]);
    cb(null, ext && mime);
  }
});

// GET /api/banner - ดึง banner ที่ active
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*, 
              COALESCE(b.alt_text, TRIM(CONCAT(u.firstname, ' ', u.lastname)), u.username) AS sender_name
       FROM public.banner_messages b
       LEFT JOIN public.users u ON b.created_by = u.id
       WHERE b.is_active = true
       ORDER BY b.priority DESC, b.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/banner - เพิ่มข้อความประกาศใหม่ (รองรับ upload รูป)
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const { text, type, alt_text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const created_by = req.user ? req.user.id : null;
    const image_url = req.file ? `/uploads/banner/${req.file.filename}` : null;
    const content_type = req.file ? 'image' : 'text';

    const result = await pool.query(
      `INSERT INTO public.banner_messages (text, alt_text, type, image_url, content_type, is_active, priority, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, true, 1, $6, NOW())
       RETURNING *`,
      [text.trim(), alt_text || null, type || 'info', image_url, content_type, created_by]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
