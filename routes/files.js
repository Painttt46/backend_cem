import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Base uploads directory
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Helper: สร้าง path ตาม type/year/month/day
const getUploadPath = (type) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  const uploadPath = path.join(uploadsDir, type || 'general', String(year), month, day);
  
  // สร้างโฟลเดอร์ถ้ายังไม่มี
  if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
  }
  
  return uploadPath;
};

// Helper: หาไฟล์ (รองรับทั้งที่เก่าและใหม่)
const findFile = (filename) => {
  // 1. เช็คที่ root uploads ก่อน (ไฟล์เก่า)
  const oldPath = path.join(uploadsDir, filename);
  if (fs.existsSync(oldPath)) {
    return oldPath;
  }
  
  // 2. หาในโฟลเดอร์ย่อย (ไฟล์ใหม่)
  const searchInDir = (dir) => {
    if (!fs.existsSync(dir)) return null;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const itemPath = path.join(dir, item);
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

// Configure multer - dynamic destination
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.query.type || req.body.type || 'general';
    const uploadPath = getUploadPath(type);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, uniqueSuffix + '-' + originalName);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024 // 200MB limit
  }
});

// Upload files
router.post('/upload', (req, res) => {
  upload.array('files', 5)(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ 
        success: false, 
        error: err.message 
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
    res.sendFile(path.resolve(filePath));
  } else {
    res.status(404).json({ error: 'ไฟล์ไม่พบ' });
  }
});

// Delete file
router.delete('/:filename', (req, res) => {
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
});

export default router;
