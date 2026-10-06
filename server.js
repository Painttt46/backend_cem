import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { sendDailyWorkSummaryToTeams } from './routes/daily_work.js';
import pool from './config/database.js';
import { verifyToken } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import leaveRoutes from './routes/leave.js';
import fileRoutes from './routes/files.js';
import dailyWorkRoutes from './routes/daily_work.js';
import tasksRoutes from './routes/tasks.js';
import taskStepsRoutes from './routes/taskSteps.js';
import usersRoutes from './routes/users.js';
import carBookingRoutes from './routes/car_booking.js';
import rolePermissionsRoutes from './routes/role_permissions.js';
import settingsRoutes from './routes/settings.js';
import auditLogsRoutes from './routes/audit_logs.js';
import erpSyncRoutes from './routes/erp_sync.js';
import procurementRoutes from './routes/procurement.js';
import procurementImportRoutes from './routes/procurementImport.js';
import salesVisitsRoutes from './routes/salesVisits.js';
import { startCarBookingScheduler } from './services/carBookingScheduler.js';
import { startWorkflowScheduler } from './services/workflowNotificationService.js';
import { sendPendingLeaveReminders } from './services/leaveReminderService.js';
import { ensureLegacyPermissions } from './utils/permissions.js';

dotenv.config();

// Prevent unhandled DB connection errors from crashing the whole process.
// Log and keep the process alive; individual route handlers still return
// proper error responses to their own requests.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection (process kept alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception (process kept alive):', err);
});

const app = express();
ensureLegacyPermissions().catch((e) => console.error('[permissions] seed deferred:', e.message));
const PORT = process.env.PORT || 3001;


// Create indexes for performance + schema migration (token_version)
pool.query(`
  CREATE INDEX IF NOT EXISTS idx_dwr_work_date ON daily_work_records(work_date);
  CREATE INDEX IF NOT EXISTS idx_dwr_step_id ON daily_work_records(step_id);
  CREATE INDEX IF NOT EXISTS idx_dwr_user_id ON daily_work_records(user_id);
  CREATE INDEX IF NOT EXISTS idx_task_steps_task_id ON task_steps(task_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_car_bookings_license_date ON car_bookings(license, selected_date);
  CREATE INDEX IF NOT EXISTS idx_car_bookings_status ON car_bookings(status);
  CREATE INDEX IF NOT EXISTS idx_leave_requests_status_user ON leave_requests(status, user_id);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0;
  ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
`).catch(() => {});

// Start schedulers
startCarBookingScheduler();
startWorkflowScheduler();

// Daily work summary - ทุกวันจันทร์-ศุกร์ เวลา 10:00 น.
cron.schedule('0 10 * * 1-5', async () => {
  console.log('[Scheduler] Sending daily work summary to Teams...');
  try {
    await sendDailyWorkSummaryToTeams();
    console.log('[Scheduler] Daily work summary sent');
  } catch (error) {
    console.error('[Scheduler] Daily work summary error:', error);
  }
}, { timezone: 'Asia/Bangkok' });

// Cleanup audit logs เก่ากว่า AUDIT_LOG_RETENTION_DAYS วัน (ค่าเริ่มต้น 30 = เหมือนเดิม) - ทุกวันเวลา 02:00 น.
const AUDIT_RETENTION_DAYS = Math.max(1, parseInt(process.env.AUDIT_LOG_RETENTION_DAYS, 10) || 30);
cron.schedule('0 2 * * *', async () => {
  console.log('[Scheduler] Cleaning up old audit logs...');
  try {
    const result = await pool.query(
      `DELETE FROM audit_logs WHERE created_at < NOW() - make_interval(days => $1)`,
      [AUDIT_RETENTION_DAYS]
    );
    console.log(`[Scheduler] Deleted ${result.rowCount} old audit logs`);
  } catch (error) {
    console.error('[Scheduler] Audit logs cleanup error:', error);
  }
}, { timezone: 'Asia/Bangkok' });

// Pending leave approval reminder - ทุกวันจันทร์-ศุกร์ เวลา 10:00 น.
cron.schedule('0 10 * * 1-5', async () => {
  console.log('[Scheduler] Sending pending leave reminders...');
  try {
    const result = await sendPendingLeaveReminders();
    console.log(`[Scheduler] Pending leave reminders: ${result.sent || 0} sent`);
  } catch (error) {
    console.error('[Scheduler] Pending leave reminder error:', error);
  }
}, { timezone: 'Asia/Bangkok' });

// Trust proxy - Required for express-rate-limit when behind proxy/load balancer
app.set('trust proxy', 1);

// Security: Helmet - Set security HTTP headers
app.use(helmet());

// Cookie parser
app.use(cookieParser());

// Security: Rate limiting
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5000, // Limit each IP to 5000 requests per windowMs
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
  origin: [
    // production (TLS ผ่าน nginx-ssl-proxy port 3000)
    'https://172.30.101.52:3000', 'https://61.91.51.126:3000', 'https://172.30.101.52',
    // dev / legacy http
    'http://172.30.101.52:8080', 'http://172.30.101.52:3000', 'http://172.30.101.52',
    'http://localhost:3001', 'http://localhost:3000', 'http://localhost', 'http://127.0.0.1:8080', 'http://127.0.0.1:3000', 'http://127.0.0.1'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ขนาดตัว JSON: route ทั่วไปรับไม่เกิน 10MB (ข้อมูลปกติเป็นหลัก KB) — เดิม 200MB ทุก route ทำให้ยิงก้อนใหญ่ใส่ route ไหนก็กิน RAM ได้
// route ที่ต้องส่งก้อนใหญ่จริงประกาศแยกไว้ "ก่อน" parser กลาง (parser ตัวแรกที่อ่าน body ได้จะเป็นตัวที่มีผล) และต้องผ่าน verifyToken ก่อน
//  - car-booking: ส่งรูปเป็น base64 ใน JSON (หลายรูป)
//  - procurement/import/confirm: ส่งแถวที่แปลงจากไฟล์ Excel ทั้งไฟล์ (ไฟล์ไม่เกิน 20MB)
app.use('/api/car-booking', verifyToken, express.json({ limit: '200mb' }));
app.use('/api/procurement/import/confirm', verifyToken, express.json({ limit: '50mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files - serve uploads folder (ต้องยืนยันตัวตน — รองรับ ?token= สำหรับ <a>/<img> links)
app.use('/uploads', verifyToken, express.static('uploads'));

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: "unhealthy", error: error.message });
  }
});

// Public server time endpoint (no auth required)
app.get("/api/server-time", async (req, res) => {
  try {
    await pool.query("SET timezone = 'Asia/Bangkok'");
    const result = await pool.query("SELECT NOW() as server_time");
    res.json({ 
      serverTime: result.rows[0].server_time,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Routes - Auth routes ไม่ต้องใช้ middleware (เพราะเป็น login)
// Forgot-password: limiter แบบเข้ม (นับ request สำเร็จด้วย) กันยิงรีเซ็ตรหัสผ่านคนอื่นเป็นวง
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'พยายามรีเซ็ตรหัสผ่านหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง',
  skipSuccessfulRequests: false
});
app.use('/api/auth/forgot-password', forgotPasswordLimiter);
app.use('/api/auth', authLimiter, authRoutes);

// Endpoint ที่ยิง notification/ดึงข้อมูลภายนอก — จำกัดเป็นพิเศษ กันสแปม Teams/ERP
const actionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'เรียกใช้งานบ่อยเกินไป กรุณาลองใหม่ภายหลัง' });
app.use('/api/daily-work/check-missing', actionLimiter);
app.use('/api/daily-work/trigger-workflow-summary', actionLimiter);
app.use('/api/erp-sync/preview', actionLimiter);

// Protected routes - ใช้ verifyToken middleware ทั้งหมด
app.use('/api/leave', verifyToken, leaveRoutes);
app.use('/api/files', verifyToken, fileRoutes);
app.use('/api/daily-work', verifyToken, dailyWorkRoutes);
app.use('/api/tasks', verifyToken, tasksRoutes);
app.use('/api/task-steps', verifyToken, taskStepsRoutes);
app.use('/api/users', verifyToken, usersRoutes);
app.use('/api/car-booking', verifyToken, carBookingRoutes);
app.use('/api/role-permissions', verifyToken, rolePermissionsRoutes);
app.use('/api/settings', verifyToken, settingsRoutes);
app.use('/api/audit-logs', verifyToken, auditLogsRoutes);
app.use('/api/erp-sync', verifyToken, erpSyncRoutes);
app.use('/api/procurement', verifyToken, procurementRoutes);
app.use('/api/procurement/import', verifyToken, procurementImportRoutes);
app.use('/api/sales-visits', verifyToken, salesVisitsRoutes);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  // payload เกินขนาด (413) ต้องบอกผู้ใช้ตรง ๆ ไม่ใช่ 500 กลบหมด
  const isTooLarge = error.type === 'entity.too.large' || error.statusCode === 413 || error.status === 413;
  const status = isTooLarge ? 413 : (error.status || error.statusCode || 500);
  // body-parser แนบ limit (ไบต์) มาใน error — แต่ละ route มีเพดานไม่เท่ากัน จึงบอกตัวเลขจริงแทนค่าคงที่
  const limitMb = error.limit ? Math.max(1, Math.round(error.limit / 1024 / 1024)) : null;
  res.status(status).json({
    success: false,
    error: isTooLarge
      ? `ข้อมูล/ไฟล์ที่ส่งมาใหญ่เกินกำหนด${limitMb ? ` (สูงสุด ${limitMb}MB)` : ''} กรุณาลดจำนวนหรือขนาดไฟล์`
      : error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
  });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Node 18+ ตัด request ที่รับไม่เสร็จใน 5 นาที (requestTimeout) — ไฟล์ใหญ่ (หลักร้อย MB) ผ่านเครือข่ายช้าจะถูกตัดกลางทาง
// ปิด timeout ระดับ request ให้ upload ไฟล์ใหญ่ได้ (nginx/axios คุม timeout ฝั่งตัวเองอยู่แล้ว)
server.requestTimeout = 0;
server.timeout = 0;
server.headersTimeout = 65 * 1000;
server.keepAliveTimeout = 65 * 1000;
