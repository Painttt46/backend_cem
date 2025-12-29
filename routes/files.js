import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Create uploads directory if it doesn't exist
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
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
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Upload files
router.post('/upload', (req, res) => {
  console.log('=== File Upload Request ===');
  console.log('Content-Type:', req.headers['content-type']);
  
  upload.array('files', 5)(req, res, (err) => {
    if (err) {
      console.error('Multer error:', err);
      return res.status(400).json({ 
        success: false, 
        error: err.message 
      });
    }
    
    try {
      console.log('Files received:', req.files?.length || 0);
      console.log('Files details:', req.files?.map(f => ({ name: f.originalname, size: f.size, path: f.path })));
      
      if (!req.files || req.files.length === 0) {
        console.log('No files in request');
        return res.status(400).json({ 
          success: false, 
          error: 'No files uploaded' 
        });
      }
      
      const fileNames = req.files.map(file => file.filename);
      console.log('Saved filenames:', fileNames);
      
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
  const filePath = path.join(uploadsDir, filename);
  
  if (fs.existsSync(filePath)) {
    const originalName = filename.split('-').slice(2).join('-');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`);
    res.download(filePath, originalName);
  } else {
    res.status(404).json({ error: 'ไฟล์ไม่พบ' });
  }
});

export default router;
