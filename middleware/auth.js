import jwt from 'jsonwebtoken';
import pool from '../config/database.js';

// Middleware สำหรับตรวจสอบ JWT token
export const verifyToken = async (req, res, next) => {
  try {
    // อ่าน token จาก cookie หรือ Authorization header
    let token = req.cookies?.token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        token = authHeader.replace('Bearer ', '');
      }
    }

    // รองรับ token จาก query string (สำหรับ img src)
    if (!token && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // ตรวจสอบว่า user ยังมีอยู่และ active + token ยังไม่ถูก revoke ด้วย token_version
      const result = await pool.query(
        'SELECT id, username, role, firstname, lastname, token_version FROM users WHERE id = $1 AND is_active = true',
        [decoded.userId]
      );
      
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      const user = result.rows[0];
      
      // token เก่า (ก่อนเพิ่ม token_version) ยังใช้ได้จนหมดอายุ — token ใหม่จะมี tv เสมอ
      const tokenVersion = decoded.tv ?? 0;
      if ((user.token_version || 0) !== tokenVersion) {
        return res.status(401).json({ error: 'Token revoked', revoked: true });
      }
      
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        firstname: user.firstname,
        lastname: user.lastname
      };
      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', expired: true });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Middleware สำหรับตรวจสอบ role
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    
    next();
  };
};
