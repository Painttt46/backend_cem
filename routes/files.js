import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { logAudit } from '../utils/auditHelper.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

// Base uploads directory
const uploadsDir = path.resolve('./uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// type ที่อนุญาต — กัน path traversal ผ่าน query/body type
const ALLOWED_TYPES = ['daily_work', 'tasks', 'leave', 'procurement', 'general'];

// Helper: สร้าง path ตาม type/year/month/day
const getUploadPath = (type) => {
  const safeType = ALLOWED_TYPES.includes(type) ? type : 'general';
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const uploadPath = path.join(uploadsDir, safeType, String(year), month, day);

  // สร้างโฟลเดอร์ถ้ายังไม่มี
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }

  return uploadPath;
};

// Helper: กัน path traversal — ต้องเป็นชื่อไฟล์ล้วน และ path จริงต้องอยู่ใน uploads เท่านั้น
const resolveSafeFilePath = (filename) => {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;
  const resolved = path.resolve(uploadsDir, filename);
  if (!resolved.startsWith(uploadsDir + path.sep) && resolved !== uploadsDir) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
};

// Helper: หาไฟล์ (รองรับทั้งที่เก่าและใหม่) — คืน path ที่ปลอดภัยแล้วเท่านั้น
const findFile = (filename) => {
  // กัน path traversal: ห้าม /, \, ..
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) return null;

  // 1. เช็คที่ root uploads ก่อน (ไฟล์เก่า)
  const oldPath = path.resolve(uploadsDir, filename);
  if (oldPath.startsWith(uploadsDir + path.sep) && fs.existsSync(oldPath) && fs.statSync(oldPath).isFile()) {
    return oldPath;
  }

  // 2. หาในโฟลเดอร์ย่อย (ไฟล์ใหม่) — ตรวจผลลัพธ์ว่ายังอยู่ใน uploads เท่านั้น
  const searchInDir = (dir) => {
    if (!fs.existsSync(dir)) return null;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const itemPath = path.resolve(dir, item);
      if (!itemPath.startsWith(uploadsDir + path.sep)) continue;
      const stat = fs.statSync(itemPath);
      if (stat.isDirectory()) {
        const found = searchInDir(itemPath);
        if (found) return found;
      } else if (item === filename) {
        return itemPath;
      }
    }
    return null;
  };

  return searchInDir(uploadsDir);
};

// ลบไฟล์ที่อัปโหลดตามรายชื่อ (ใช้ตอนลบ record ที่แนบไฟล์ — กันไฟล์ค้างบนดิสก์)
// รับเฉพาะชื่อไฟล์ (string) — ไฟล์จาก ERP ที่เก็บเป็น object/URL จะข้าม
export const removeUploadedFiles = (files) => {
  let list = files;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return 0; }
  }
  if (!Array.isArray(list)) return 0;
  let removed = 0;
  for (const name of list) {
    if (typeof name !== 'string') continue;
    try {
      const filePath = findFile(name);
      if (filePath) {
        fs.unlinkSync(filePath);
        removed++;
      }
    } catch (error) {
      console.error('Failed to remove uploaded file:', name, error.message);
    }
  }
  return removed;
};

// ลบไฟล์ตาม path เต็ม (ไฟล์ที่ multer เขียนไว้ครึ่งทางเมื่อการอัปถูกยกเลิก/ล้มเหลว)
const removePaths = (paths) => {
  for (const p of paths || []) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
};

// Configure multer - dynamic destination
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.query.type || req.body.type || 'general';
    const uploadPath = getUploadPath(type);
    req._uploadDir = uploadPath;
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const finalName = uniqueSuffix + '-' + originalName;
    // จำ path ไว้เพื่อลบทิ้งถ้าการอัปโหลดไม่จบ
    (req._uploadedPaths = req._uploadedPaths || []).push(path.join(req._uploadDir, finalName));
    cb(null, finalName);
  }
});

const upload = multer({ 
  storage: storage,
  // ไม่จำกัดขนาดไฟล์ (จำกัดแค่จำนวนไฟล์ที่ upload.array('files', 20))
  // บล็อกนามสกุลที่รันฝั่ง browser ได้ (stored XSS) — ชนิดอื่นอัปโหลดได้ตามปกติ
  fileFilter: (req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8').toLowerCase();
    const blocked = ['.html', '.htm', '.svg', '.js', '.mjs', '.xhtml', '.xht'];
    const isBlocked = blocked.some(ext => originalName.endsWith(ext));
    if (isBlocked) {
      cb(new Error('ไม่อนุญาตให้อัปโหลดไฟล์ประเภทนี้ (html/svg/js)'));
      return;
    }
    cb(null, true);
  }
});

// Upload files
router.post('/upload', (req, res) => {
  // ผู้ใช้ปิดหน้า/รีเฟรช/เน็ตหลุดกลางทาง → response ไม่เคยส่งถึง client → ลบไฟล์ที่เขียนค้างไว้ครึ่งเดียว
  // (ถ้าอัปสำเร็จ response ถูกส่งครบก่อนปิดการเชื่อมต่อ จึงไม่ลบ)
  res.on('close', () => {
    if (!res.writableFinished) removePaths(req._uploadedPaths);
  });

  upload.array('files', 20)(req, res, async (err) => {
    if (err) {
      // ล้มเหลว (ไฟล์ต้องห้าม/ใหญ่เกิน/เกินจำนวน) — ไฟล์ก่อนหน้าในชุดเดียวกันที่เขียนไปแล้วต้องไม่ค้าง
      removePaths(req._uploadedPaths);
      console.error('Multer error:', err);
      let message = 'ไม่สามารถอัพโหลดไฟล์ได้ กรุณาตรวจสอบขนาด/จำนวนไฟล์';
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        message = 'แนบไฟล์ได้สูงสุด 20 ไฟล์ต่อครั้ง';
      } else if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'ไฟล์ใหญ่เกิน 200MB';
      }
      return res.status(400).json({
        success: false,
        error: message
      });
    }
    
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'No files uploaded' 
        });
      }
      
      const fileNames = req.files.map(file => file.filename);
      
      logAudit(req, {
        action: 'CREATE',
        tableName: 'files',
        recordName: `อัพโหลด ${fileNames.length} ไฟล์`,
        newData: { files: fileNames, type: req.query.type || 'general' }
      });
      
      res.json({ 
        success: true, 
        files: fileNames,
        message: `อัพโหลด ${fileNames.length} ไฟล์สำเร็จ`
      });
    } catch (error) {
      console.error('Error processing files:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to process files' 
      });
    }
  });
});

// Download file
router.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = findFile(filename);
  
  if (filePath) {
    const originalName = filename.split('-').slice(2).join('-');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    res.download(filePath, originalName);
  } else {
    res.status(404).json({ error: 'ไฟล์ไม่พบ' });
  }
});

// View file (for images)
router.get('/view/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = findFile(filename);
  
  if (filePath) {
    // บังคับดาวน์โหลด + ห้าม sniff กัน stored XSS ผ่านไฟล์ที่อัปโหลด
    res.sendFile(path.resolve(filePath), {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename.split('-').slice(2).join('-'))}`
      }
    });
  } else {
    res.status(404).json({ error: 'ไฟล์ไม่พบ' });
  }
});

// Delete file
// ไม่มีการ track เจ้าของไฟล์ในระบบ (ไม่มี DB row ต่อไฟล์) จึงจำกัดสิทธิ์ลบไว้ที่ role ผู้ดูแลเท่านั้น
router.delete('/:filename', requireRole('admin', 'superadmin'), (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = findFile(filename);

    if (filePath) {
      fs.unlinkSync(filePath);
      logAudit(req, {
        action: 'DELETE',
        tableName: 'files',
        recordName: `ลบไฟล์: ${filename}`
      });
      res.json({ success: true, message: 'ลบไฟล์สำเร็จ' });
    } else {
      res.status(404).json({ error: 'ไฟล์ไม่พบ' });
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'ไม่สามารถลบไฟล์ได้' });
  }
});

export default router;
