import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

const BASE_UPLOAD_DIR = './uploads';

// Valid upload types
const VALID_TYPES = ['leave', 'daily_work', 'car_booking', 'profile', 'expense', 'general'];

// Get upload path: uploads/{type}/{year}/{month}/
function getUploadPath(type) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  
  // Profile doesn't need year/month subfolder
  if (type === 'profile') {
    return path.join(BASE_UPLOAD_DIR, type);
  }
  
  return path.join(BASE_UPLOAD_DIR, type, String(year), month);
}

// Create directory if not exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type || req.body.type || 'general';
    const uploadPath = getUploadPath(type);
    ensureDir(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const userId = req.user?.id || 'unknown';
    const timestamp = Date.now();
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    // Format: user_{userId}_{timestamp}_{originalName}
    cb(null, `user_${userId}_${timestamp}_${originalName}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Upload files with type
// POST /api/files/upload/:type (leave, daily_work, car_booking, profile, expense, general)
router.post('/upload/:type', (req, res) => {
  const { type } = req.params;
  
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ 
      success: false, 
      error: `Invalid type. Valid types: ${VALID_TYPES.join(', ')}` 
    });
  }

  upload.array('files', 5)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    
    const files = req.files.map(file => ({
      filename: file.filename,
      path: `${type}/${path.relative(path.join(BASE_UPLOAD_DIR, type), file.path)}`,
      originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      size: file.size
    }));
    
    res.json({ 
      success: true, 
      files,
      message: `อัพโหลด ${files.length} ไฟล์สำเร็จ`
    });
  });
});

// Upload single profile image
router.post('/upload-profile', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }
  
  res.json({
    success: true,
    file: {
      filename: req.file.filename,
      path: `profile/${req.file.filename}`
    }
  });
});

// Download file - NEW format with full path
// GET /api/files/download/:type/:year/:month/:filename
router.get('/download/:type/:year/:month/:filename', (req, res) => {
  const { type, year, month, filename } = req.params;
  const filePath = path.join(BASE_UPLOAD_DIR, type, year, month, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'ไฟล์ไม่พบ' });
  }
  
  // Extract original name from filename (user_123_1234567890_originalname.pdf)
  const parts = filename.split('_');
  const originalName = parts.length > 3 ? parts.slice(3).join('_') : filename;
  
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  res.download(filePath, originalName);
});

// Download file - LEGACY format (backward compatibility)
// GET /api/files/download/:filename
router.get('/download/:filename', (req, res) => {
  const { filename } = req.params;
  
  // Search in all directories
  const searchDirs = [
    BASE_UPLOAD_DIR, // root uploads folder (old files)
    ...VALID_TYPES.map(t => path.join(BASE_UPLOAD_DIR, t))
  ];
  
  let filePath = null;
  
  // First check root uploads folder (old format)
  const rootPath = path.join(BASE_UPLOAD_DIR, filename);
  if (fs.existsSync(rootPath)) {
    filePath = rootPath;
  } else {
    // Search in subdirectories recursively
    const findFile = (dir) => {
      if (!fs.existsSync(dir)) return null;
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        if (fs.statSync(itemPath).isDirectory()) {
          const found = findFile(itemPath);
          if (found) return found;
        } else if (item === filename) {
          return itemPath;
        }
      }
      return null;
    };
    
    for (const dir of searchDirs) {
      filePath = findFile(dir);
      if (filePath) break;
    }
  }
  
  if (!filePath) {
    return res.status(404).json({ error: 'ไฟล์ไม่พบ' });
  }
  
  // Extract original name
  const parts = filename.split('-');
  const originalName = parts.length > 2 ? parts.slice(2).join('-') : filename;
  
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
  res.download(filePath, originalName);
});

// Download profile image (no year/month)
router.get('/download/profile/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(BASE_UPLOAD_DIR, 'profile', filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'ไฟล์ไม่พบ' });
  }
  
  res.sendFile(path.resolve(filePath));
});

// List files by type and optional user
// GET /api/files/list/:type?user_id=123&year=2025&month=01
router.get('/list/:type', (req, res) => {
  const { type } = req.params;
  const { user_id, year, month } = req.query;
  
  let searchPath;
  if (type === 'profile') {
    searchPath = path.join(BASE_UPLOAD_DIR, type);
  } else if (year && month) {
    searchPath = path.join(BASE_UPLOAD_DIR, type, year, month);
  } else if (year) {
    searchPath = path.join(BASE_UPLOAD_DIR, type, year);
  } else {
    searchPath = path.join(BASE_UPLOAD_DIR, type);
  }
  
  if (!fs.existsSync(searchPath)) {
    return res.json({ success: true, files: [] });
  }
  
  const getAllFiles = (dir, fileList = []) => {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      const filePath = path.join(dir, file);
      if (fs.statSync(filePath).isDirectory()) {
        getAllFiles(filePath, fileList);
      } else {
        fileList.push({
          filename: file,
          path: path.relative(BASE_UPLOAD_DIR, filePath),
          size: fs.statSync(filePath).size,
          created: fs.statSync(filePath).birthtime
        });
      }
    });
    return fileList;
  };
  
  let files = getAllFiles(searchPath);
  
  // Filter by user_id if provided
  if (user_id) {
    files = files.filter(f => f.filename.startsWith(`user_${user_id}_`));
  }
  
  res.json({ success: true, files });
});

// Delete file
router.delete('/delete', (req, res) => {
  const { filepath } = req.body;
  
  if (!filepath) {
    return res.status(400).json({ success: false, error: 'filepath required' });
  }
  
  const fullPath = path.join(BASE_UPLOAD_DIR, filepath);
  
  // Security: prevent path traversal
  if (!fullPath.startsWith(path.resolve(BASE_UPLOAD_DIR))) {
    return res.status(403).json({ success: false, error: 'Invalid path' });
  }
  
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }
  
  fs.unlinkSync(fullPath);
  res.json({ success: true, message: 'ลบไฟล์สำเร็จ' });
});

export default router;
