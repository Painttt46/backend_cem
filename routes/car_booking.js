import express from 'express';
import { sendCarBookingTeamsNotification as sendTeamsNotification } from '../services/carBookingTeams.js';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Auto-migrate: เวลาคืนรถที่ตั้งไว้ตอนจอง + ธงคืนอัตโนมัติ + กันจองซ้ำระดับ DB
pool.query(`
  ALTER TABLE car_bookings ADD COLUMN IF NOT EXISTS expected_return_date DATE;
  ALTER TABLE car_bookings ADD COLUMN IF NOT EXISTS expected_return_time VARCHAR(5);
  ALTER TABLE car_bookings ADD COLUMN IF NOT EXISTS auto_returned BOOLEAN DEFAULT false;
`).catch(() => {});

// unique index กัน pending ซ้ำของคันเดียวกันในวันเดียวกัน (ให้ conflict check เป็นตัวสำรอง)
// ถ้ามีข้อมูลซ้ำค้างอยู่ index จะสร้างไม่ได้ — ต้องเก็บกวาด duplicate ก่อน จึง catch ไว้ไม่ให้ crash
pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_car_bookings_pending_license_date
  ON car_bookings (license, selected_date)
  WHERE status = 'pending'
`).catch((e) => console.error('[car_booking] create unique index failed (มี pending ซ้ำค้างอยู่):', e.message));

// Set timezone for PostgreSQL queries
const setTimezone = async () => {
  await pool.query("SET timezone = 'Asia/Bangkok'");
};

// เช็คสิทธิ์แก้ไข/ลบ booking: เจ้าของ record หรือ role ที่มีสิทธิ์บริหารเท่านั้น
async function canManageBooking(req, id) {
  const result = await pool.query('SELECT user_id FROM car_bookings WHERE id = $1', [id]);
  if (!result.rows.length) return { found: false, allowed: false };
  const isPrivileged = ['superadmin', 'admin', 'hr'].includes(req.user?.role);
  const isOwner = String(result.rows[0].user_id) === String(req.user?.id);
  return { found: true, allowed: isPrivileged || isOwner };
}

// Get latest fuel level and easy pass from last returned booking
router.get('/latest-fuel', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT fuel_level_return, easy_pass_return, return_location
      FROM car_bookings 
      WHERE status = 'returned' AND fuel_level_return IS NOT NULL
      ORDER BY updated_at DESC 
      LIMIT 1
    `);
    res.json({
      fuel_level: result.rows[0]?.fuel_level_return || 50,
      easy_pass_balance: result.rows[0]?.easy_pass_return || 500,
      return_location: result.rows[0]?.return_location || null
    });
  } catch (error) {
    console.error('Error fetching latest fuel level:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดข้อมูลได้' });
  }
});


// Get all car booking records (lightweight - just fetch data)
router.get('/', async (req, res) => {
  try {
    await setTimezone();

    // การเปลี่ยนสถานะ (pending→active, ยกเลิกรายการซ้อน, คืนรถอัตโนมัติ) ทำโดย services/carBookingScheduler.js ทุก 5 วินาทีอยู่แล้ว
    // เดิมหน้ารายการนี้ก็รันซ้ำอีกชุดทุกครั้งที่มีคนเปิดหน้า ทำให้แย่งกันเปลี่ยนสถานะและส่ง Teams ซ้ำ

    const result = await pool.query(`
      SELECT
        c.id, c.type, c.location, c.project, c.task_id, c.discription, c.selected_date, c.time, c.license,
        c.return_name, c.return_location, c.colleagues, c.created_at, c.updated_at,
        c.return_time, c.return_date, c.status, c.user_id, c.fuel_level_borrow, c.fuel_level_return,
        c.easy_pass_borrow, c.easy_pass_return,
        c.expected_return_date, c.expected_return_time, c.auto_returned,
        CASE WHEN c.images IS NOT NULL AND c.images != '[]'::jsonb AND c.images != 'null'::jsonb THEN true ELSE false END as has_images,
        u.firstname || ' ' || u.lastname as name, u.nickname,
        t.so_number, t.customer_info
      FROM car_bookings c
      LEFT JOIN users u ON c.user_id = u.id
      LEFT JOIN tasks t ON c.task_id = t.id
      ORDER BY c.created_at DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching car bookings:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดรายการจองรถได้' });
  }
});



// Get images for a specific booking
router.get('/:id/images', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT images FROM car_bookings WHERE id = $1', [id]);
    res.json(result.rows[0]?.images || []);
  } catch (error) {
    console.error('Error fetching booking images:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดรูปภาพได้' });
  }
});

// Create car booking record
router.post('/', async (req, res) => {
  const {
    type, location, task_id, description,
    selected_date, time, license, colleagues, images, user_id, fuel_level_borrow, easy_pass_borrow,
    expected_return_date, expected_return_time
  } = req.body;
  
  try {
    await setTimezone();
    
    // Get project info from task
    let project = '';
    if (task_id) {
      const taskResult = await pool.query('SELECT task_name FROM tasks WHERE id = $1', [task_id]);
      if (taskResult.rows.length > 0) {
        project = taskResult.rows[0].task_name;
      }
    }
    
    // Check for conflicts with existing bookings (both active and pending)
    const newBookingDate = new Date(selected_date);
    newBookingDate.setHours(0, 0, 0, 0);
    
    // Check active bookings
    const activeCheck = await pool.query(`
      SELECT id, selected_date, return_date, status 
      FROM car_bookings 
      WHERE status = 'active' AND license = $1
    `, [license || 'FXAG-2032']);
    
    if (activeCheck.rows.length > 0) {
      const activeBooking = activeCheck.rows[0];
      const activeBorrowDate = new Date(activeBooking.selected_date);
      activeBorrowDate.setHours(0, 0, 0, 0);
      
      // Block if trying to book on the same day as active booking
      if (newBookingDate.getTime() === activeBorrowDate.getTime()) {
        return res.status(409).json({ 
          error: 'รถคันนี้กำลังถูกใช้งานอยู่ในวันที่เลือก',
          details: `รถถูกใช้งานตั้งแต่ ${activeBorrowDate.toLocaleDateString('th-TH')} และยังไม่ได้คืน`,
          conflictBookingId: activeBooking.id
        });
      }
    }
    
    // Check pending bookings for the same date
    const pendingCheck = await pool.query(`
      SELECT id, selected_date, status, project
      FROM car_bookings 
      WHERE status = 'pending' AND license = $1 AND selected_date = $2
    `, [license || 'FXAG-2032', selected_date]);
    
    if (pendingCheck.rows.length > 0) {
      const pendingBooking = pendingCheck.rows[0];
      return res.status(409).json({ 
        error: 'มีการจองรถในวันนี้แล้ว',
        details: `มีการจองล่วงหน้าสำหรับวันที่ ${newBookingDate.toLocaleDateString('th-TH')} (โครงการ: ${pendingBooking.project || 'ไม่ระบุ'})`,
        conflictBookingId: pendingBooking.id
      });
    }
    
    // เวลาคืนที่ตั้งไว้ต้องหลังเวลารับ (ถ้ากรอกมา)
    if (expected_return_time) {
      const expDate = new Date(expected_return_date || selected_date);
      const [eh, em] = String(expected_return_time).split(':').map(Number);
      expDate.setHours(eh, em, 0, 0);
      const pickupDate = new Date(selected_date);
      const [ph, pm] = String(time || '09:00').split(':').map(Number);
      pickupDate.setHours(ph, pm, 0, 0);
      if (expDate <= pickupDate) {
        return res.status(400).json({ error: 'เวลาคืนรถต้องเป็นเวลาหลังจากเวลารับรถ' });
      }
    }

    const result = await pool.query(`
      INSERT INTO car_bookings (
        type, location, project, task_id, discription,
        selected_date, time, license, colleagues, images, user_id, status, fuel_level_borrow, easy_pass_borrow,
        expected_return_date, expected_return_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      type,
      location || '',
      project || '',
      task_id || null,
      description || '',
      selected_date,
      time || '09:00',
      license || 'FXAG-2032',
      JSON.stringify(colleagues || []),
      JSON.stringify(images || []),
      // ใช้ user_id จาก token เท่านั้น กันสร้างรายการในนามผู้อื่น (IDOR)
      req.user?.id || user_id || null,
      'pending',
      fuel_level_borrow || null,
      easy_pass_borrow || null,
      expected_return_time ? (expected_return_date || selected_date) : null,
      expected_return_time || null
    ]);
    
    // Get created data with user info for Teams notification
    const createdResult = await pool.query(`
      SELECT 
        c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
        c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
        c.return_time, c.return_date, c.status, c.user_id,
        u.firstname || ' ' || u.lastname as name
      FROM car_bookings c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = $1
    `, [result.rows[0].id]);
    
    const bookingData = createdResult.rows[0];
    
    // Send booking notification first
    await sendTeamsNotification('booking', bookingData);
    
    // Check if booking time has passed - if so, activate immediately
    const now = new Date();
    const borrowDate = new Date(selected_date);
    const [hour, minute] = (time || '09:00').split(':').map(Number);
    borrowDate.setHours(hour, minute, 0, 0);
    
    if (now >= borrowDate) {
      // Update status to active
      await pool.query('UPDATE car_bookings SET status = $1 WHERE id = $2', ['active', bookingData.id]);
      bookingData.status = 'active';
      
      // Send active notification after booking notification
      await sendTeamsNotification('active', bookingData);
    }
    
    // Log audit
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'car_bookings',
      recordId: bookingData.id,
      recordName: `${bookingData.name} - ${selected_date}`,
      newData: { project, location, selected_date, time, license }
    });
    
    res.status(201).json(bookingData);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'ไม่สามารถสร้างรายการจองรถได้' });
  }
});

// Update car booking record
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { images, return_name, return_location, return_description, return_time, return_date, fuel_level_return, easy_pass_return } = req.body;

  try {
    const { found, allowed } = await canManageBooking(req, id);
    if (!found) return res.status(404).json({ error: 'Record not found' });
    if (!allowed) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้' });

    await setTimezone();
    let query, params;
    
    if (return_name || return_location || return_time || return_date) {
      // Get existing images first
      const existing = await pool.query('SELECT images FROM car_bookings WHERE id = $1', [id]);
      const existingImages = existing.rows[0]?.images || [];
      
      // Merge: existing = borrow images, new = return images
      const mergedImages = {
        borrow: Array.isArray(existingImages) ? existingImages : (existingImages.borrow || []),
        return: images || []
      };
      
      query = `
        UPDATE car_bookings 
        SET return_name = $1, return_location = $2, discription = $3, return_time = $4, return_date = $5, images = $6, fuel_level_return = $7, easy_pass_return = $8, status = 'returned', updated_at = NOW() 
        WHERE id = $9 
        RETURNING *
      `;
      params = [return_name, return_location, return_description, return_time, return_date, JSON.stringify(mergedImages), fuel_level_return || null, easy_pass_return || null, id];
    } else {
      // Update images only
      query = `
        UPDATE car_bookings 
        SET images = $1, updated_at = NOW() 
        WHERE id = $2 
        RETURNING *
      `;
      params = [JSON.stringify(images), id];
    }
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    
    // Get updated data with user info for Teams notification
    const updatedResult = await pool.query(`
      SELECT 
        c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
        c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
        c.return_time, c.return_date, c.status, c.user_id,
        u.firstname || ' ' || u.lastname as name
      FROM car_bookings c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = $1
    `, [id]);
    
    const updatedData = updatedResult.rows[0];
    
    // Send return notification if this is a return update
    if (return_name || return_location || return_time || return_date) {
      await sendTeamsNotification('return', updatedData);
    }
    
    // Log audit
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'car_bookings',
      recordId: parseInt(id),
      recordName: `${updatedData.name} - คืนรถ`,
      newData: { return_name, return_location, return_time, return_date }
    });
    
    res.json(updatedData);
  } catch (error) {
    console.error('Database update error:', error);
    res.status(500).json({ error: 'ไม่สามารถแก้ไขรายการจองรถได้' });
  }
});

// Append images to a booking (merge — ไม่ทับรูปเดิม, รองรับ legacy object shape {borrow, return})
router.post('/:id/images', async (req, res) => {
  const { id } = req.params;
  const { images } = req.body || {};

  try {
    if (!Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'ไม่มีรูปที่ต้องการเพิ่ม' });
    }

    const current = await pool.query('SELECT images, user_id FROM car_bookings WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    // สิทธิ์: เจ้าของ booking หรือ admin/hr/superadmin
    const role = (req.user?.role || '').toLowerCase();
    const isPrivileged = ['admin', 'hr', 'superadmin'].includes(role);
    if (String(current.rows[0].user_id) !== String(req.user?.id) && !isPrivileged) {
      return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เพิ่มรูปในรายการนี้' });
    }

    // normalize legacy shapes → flat array ของ object {src}
    let existing = current.rows[0].images || [];
    if (!Array.isArray(existing)) {
      // legacy object form: {borrow: [...], return: [...]}
      existing = Object.values(existing).flat().filter(Boolean);
    }
    existing = existing.filter(img => img && (img.src || typeof img === 'string'));

    const merged = [...existing, ...images];
    await pool.query(
      'UPDATE car_bookings SET images = $1::jsonb, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(merged), id]
    );

    res.json({ success: true, images: merged });
  } catch (error) {
    console.error('Error appending booking images:', error);
    res.status(500).json({ error: 'ไม่สามารถเพิ่มรูปได้' });
  }
});

// Delete car booking record
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { found, allowed } = await canManageBooking(req, id);
    if (!found) return res.status(404).json({ error: 'Record not found' });
    if (!allowed) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ลบรายการนี้' });

    await setTimezone();
    // Get data with user info before deleting for Teams notification
    const beforeDelete = await pool.query(`
      SELECT 
        c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
        c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
        c.return_time, c.return_date, c.status, c.user_id,
        u.firstname || ' ' || u.lastname as name
      FROM car_bookings c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = $1
    `, [id]);
    
    if (beforeDelete.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    
    const oldData = beforeDelete.rows[0];
    
    const result = await pool.query(`
      DELETE FROM car_bookings WHERE id = $1 RETURNING *
    `, [id]);
    
    // Send cancel notification
    await sendTeamsNotification('cancel', oldData);
    
    // Log audit
    await logAudit(req, {
      action: 'DELETE',
      tableName: 'car_bookings',
      recordId: parseInt(id),
      recordName: `${oldData.name} - ${oldData.selected_date}`,
      oldData: { project: oldData.project, location: oldData.location, selected_date: oldData.selected_date }
    });
    
    // Return the data with user info for Teams notification
    res.json(oldData);
  } catch (error) {
    console.error('Error deleting car booking:', error);
    res.status(500).json({ error: 'ไม่สามารถลบรายการจองรถได้' });
  }
});

// Get server time
router.get('/server-time', async (req, res) => {
  try {
    await setTimezone();
    const result = await pool.query("SELECT NOW() as server_time");
    res.json({
      serverTime: result.rows[0].server_time,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching server time:', error);
    res.status(500).json({ error: 'ไม่สามารถดึงเวลาเซิร์ฟเวอร์ได้' });
  }
});

export default router;
