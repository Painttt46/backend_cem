import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import pool from './config/database.js';
import { verifyToken } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import leaveRoutes from './routes/leave.js';
import fileRoutes from './routes/files.js';
import dailyWorkRoutes from './routes/daily_work.js';
import tasksRoutes from './routes/tasks.js';
import usersRoutes from './routes/users.js';
import carBookingRoutes from './routes/car_booking.js';
import rolePermissionsRoutes from './routes/role_permissions.js';
import settingsRoutes from './routes/settings.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - Required for express-rate-limit when behind proxy/load balancer
app.set('trust proxy', 1);

// Security: Helmet - Set security HTTP headers
app.use(helmet());

// Cookie parser
app.use(cookieParser());

// Security: Rate limiting
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});

// Apply rate limiting to all routes
app.use(limiter);

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Limit each IP to 20 login attempts per 5 minutes
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true // Don't count successful logins
});

// CORS configuration
app.use(cors({
  origin: ['http://localhost:8080', 'http://localhost:3001', 'http://127.0.0.1:8080'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files - serve uploads folder
app.use('/uploads', express.static('uploads'));

// Test database connection
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, time: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug route to test authentication
app.get('/api/debug/auth', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  res.json({
    hasAuthHeader: !!authHeader,
    authHeader: authHeader,
    hasToken: !!token,
    token: token ? token.substring(0, 20) + '...' : null
  });
});

// Test route without authentication
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!', timestamp: new Date().toISOString() });
});

// Routes - Auth routes ไม่ต้องใช้ middleware (เพราะเป็น login)
app.use('/api/auth', authLimiter, authRoutes);

// Protected routes - ใช้ verifyToken middleware ทั้งหมด
app.use('/api/leave', verifyToken, leaveRoutes);
app.use('/api/files', verifyToken, fileRoutes);
app.use('/api/daily-work', verifyToken, dailyWorkRoutes);
app.use('/api/tasks', verifyToken, tasksRoutes);
app.use('/api/users', verifyToken, usersRoutes);
app.use('/api/car-booking', verifyToken, carBookingRoutes);
app.use('/api/role-permissions', verifyToken, rolePermissionsRoutes);
app.use('/api/settings', verifyToken, settingsRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({
    success: false,
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
