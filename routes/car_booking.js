import express from 'express';
import pool from '../config/database.js';
import fetch from 'node-fetch';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Set timezone for PostgreSQL queries
const setTimezone = async () => {
  await pool.query("SET timezone = 'Asia/Bangkok'");
};

// Teams notification function
async function sendTeamsNotification(type, data) {
  const webhookUrl = 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/4bffff1623c14e5ba6d5247b4aa8f145/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=TbXoIRcOZXL2QHHESf0jIDJ-JMr4jvh-XRovQya1_hM';
  
  try {
    const message = createCarBookingMessage(type, data);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    
    if (!response.ok) {
      console.error('Teams notification failed:', response.status);
    } else {
      console.log('Teams notification sent successfully');
    }
  } catch (error) {
    console.error('Teams notification error:', error);
  }
}

function createCarBookingMessage(type, data) {
  const currentTime = new Date().toLocaleString('th-TH');
  let title, color, tableData;

  switch (type) {
    case 'booking':
      title = '🚗 การจองใช้รถใหม่';
      color = 'Accent';
      let colleagues = [];
      try {
        colleagues = typeof data.colleagues === 'string' ? JSON.parse(data.colleagues) : (data.colleagues || []);
      } catch (e) {
        colleagues = [];
      }
      const colleagueNames = colleagues.length > 0 ? 
        colleagues.map(c => typeof c === 'object' ? (c.name || c.value || JSON.stringify(c)) : c).join(', ') : 'ไม่มี';
      tableData = [
        ['Ticket ID', data.id.toString()],
        ['ผู้จอง', data.name || 'ไม่ระบุ'],
        ['ผู้ร่วมงาน', colleagueNames],
        ['วันที่ใช้', new Date(data.selected_date).toLocaleDateString('th-TH')],
        ['เวลา', data.time || 'ไม่ระบุ'],
        ['สถานที่', data.location || 'ไม่ระบุ'],
        ['โครงการ', data.project || 'ไม่ระบุ'],
        ['ทะเบียนรถ', data.license || 'ไม่ระบุ']
      ];
      break;
    case 'active':
      title = '🔴 รถกำลังใช้งาน';
      color = 'Attention';
      let activeColleagues = [];
      try {
        activeColleagues = typeof data.colleagues === 'string' ? JSON.parse(data.colleagues) : (data.colleagues || []);
      } catch (e) {
        activeColleagues = [];
      }
      const activeColleagueNames = activeColleagues.length > 0 ? 
        activeColleagues.map(c => typeof c === 'object' ? (c.name || c.value || JSON.stringify(c)) : c).join(', ') : 'ไม่มี';
      tableData = [
        ['Ticket ID', data.id.toString()],
        ['ผู้ใช้', data.name || 'ไม่ระบุ'],
        ['ผู้ร่วมงาน', activeColleagueNames],
        ['โครงการ', data.project || 'ไม่ระบุ'],
        ['ทะเบียนรถ', data.license || 'ไม่ระบุ'],
        ['สถานะ', 'กำลังใช้งาน']
      ];
      break;
    case 'return':
      title = '✅ แจ้งคืนรถ';
      color = 'Good';
      tableData = [
        ['Ticket ID', data.id?.toString() || 'ไม่ระบุ'],
        ['ผู้คืน', data.return_name || data.name || 'ไม่ระบุ'],
        ['โครงการ', data.project || 'ไม่ระบุ'],
        ['ทะเบียนรถ', data.license || 'ไม่ระบุ'],
        ['วันที่ยืม', data.selected_date ? new Date(data.selected_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'],
        ['เวลาเริ่มยืม', data.time || 'ไม่ระบุ'],
        ['สถานที่ยืม', data.location || 'ไม่ระบุ'],
        ['เวลาคืน', data.return_time || 'ไม่ระบุ'],
        ['สถานที่คืน', data.return_location || 'ไม่ระบุ']
      ];
      break;
    case 'cancel':
      title = '❌ ยกเลิกการจอง';
      color = 'Warning';
      tableData = [
        ['Ticket ID', data.id.toString()],
        ['ผู้ยกเลิก', data.name || 'ไม่ระบุ'],
        ['โครงการ', data.project || 'ไม่ระบุ'],
        ['ทะเบียนรถ', data.license || 'ไม่ระบุ'],
        ['วันที่จอง', data.selected_date ? new Date(data.selected_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'],
        ['เวลาจอง', data.time || 'ไม่ระบุ']
      ];
      break;
    case 'overdue_cancel':
      title = '⚠️ ยกเลิกการจองอัตโนมัติ - รถยังไม่ถูกคืน';
      color = 'Attention';
      tableData = [
        ['Ticket ID', data.id.toString()],
        ['ผู้จอง', data.name || 'ไม่ระบุ'],
        ['โครงการ', data.project || 'ไม่ระบุ'],
        ['ทะเบียนรถ', data.license || 'ไม่ระบุ'],
        ['วันที่จอง', data.selected_date ? new Date(data.selected_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'],
        ['เวลาจอง', data.time || 'ไม่ระบุ'],
        ['เหตุผล', data.cancellation_reason || 'รถยังไม่ถูกคืนจากการใช้งานก่อนหน้า']
      ];
      break;
    case 'auto_cancel':
      title = '🚫 ยกเลิกการจองอัตโนมัติ';
      color = 'Attention';
      tableData = [
        ['Ticket ID', data.id.toString()],
        ['ผู้จอง', data.name || 'ไม่ระบุ'],
        ['โครงการ', data.project || 'ไม่ระบุ'],
        ['ทะเบียนรถ', data.license || 'ไม่ระบุ'],
        ['วันที่จอง', data.selected_date ? new Date(data.selected_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'],
        ['เวลาจอง', data.time || 'ไม่ระบุ'],
        ['เหตุผล', data.reason || 'ถูกยกเลิกอัตโนมัติเนื่องจากยังมีการใช้รถอยู่']
      ];
      break;
    case 'auto_cancel_duplicate':
      title = '🚫 ยกเลิกการจองล่วงหน้าอัตโนมัติ';
      color = 'Attention';
      tableData = [
        ['Ticket ID', data.id.toString()],
        ['ผู้จอง', data.name || 'ไม่ระบุ'],
        ['โครงการ', data.project || 'ไม่ระบุ'],
        ['ทะเบียนรถ', data.license || 'ไม่ระบุ'],
        ['วันที่จอง', data.selected_date ? new Date(data.selected_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'],
        ['เวลาจอง', data.time || 'ไม่ระบุ'],
        ['เหตุผล', data.reason || 'มีการใช้รถจริงในวันเดียวกัน']
      ];
      break;
    default:
      title = '📋 การแจ้งเตือน';
      color = 'Default';
      tableData = [];
  }

  const tableRows = tableData.map(row => ({
    type: "TableRow",
    cells: [
      {
        type: "TableCell",
        items: [{ type: "TextBlock", text: row[0], weight: "Bolder", wrap: true }]
      },
      {
        type: "TableCell", 
        items: [{ type: "TextBlock", text: row[1], wrap: true, maxLines: 0 }]
      }
    ]
  }));

  return {
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      { type: 'TextBlock', text: title, size: 'Medium', weight: 'Bolder', color: color },
      { type: 'TextBlock', text: `เวลา: ${currentTime}`, size: 'Small', color: 'Default', spacing: 'None' },
      { type: 'Table', columns: [{ width: 1 }, { width: 2 }], rows: tableRows }
    ],
    msteams: {
      width: "Full"
    }
  };
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
    res.status(500).json({ error: error.message });
  }
});


// Process pending bookings - update status, cancel conflicts, notify (fire-and-forget)
async function processBookingStatuses() {
  try {
    await setTimezone();
    const now = new Date();

    const activeResult = await pool.query(`SELECT id, selected_date, return_date FROM car_bookings WHERE status = 'active' LIMIT 1`);
    const activeBooking = activeResult.rows[0] || null;

    const pendingResult = await pool.query(`
      SELECT c.id, c.selected_date, c.time, c.license, c.location, c.project, c.discription,
             c.colleagues, c.images, c.user_id, c.status, c.return_name, c.return_location,
             c.return_time, c.return_date, c.type, c.fuel_level_borrow, c.fuel_level_return,
             c.easy_pass_borrow, c.easy_pass_return,
             u.firstname || ' ' || u.lastname as name
      FROM car_bookings c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.status = 'pending'
      ORDER BY c.selected_date, c.time
    `);

    for (const record of pendingResult.rows) {
      const [hour, minute] = record.time.split(':').map(Number);
      const borrowDateTime = new Date(record.selected_date);
      borrowDateTime.setHours(hour, minute, 0, 0);
      if (now < borrowDateTime) continue;

      if (!activeBooking) {
        await pool.query('UPDATE car_bookings SET status = $1 WHERE id = $2', ['active', record.id]);
        sendTeamsNotification('active', { ...record, status: 'active' }).catch(() => {});

        const dupes = await pool.query(
          `SELECT c.id, c.project, c.license, c.selected_date, c.time, c.user_id,
                  u.firstname || ' ' || u.lastname as name
           FROM car_bookings c LEFT JOIN users u ON c.user_id = u.id
           WHERE c.id != $1 AND c.license = $2 AND c.selected_date = $3 AND c.status = 'pending'`,
          [record.id, record.license, record.selected_date]
        );
        if (dupes.rows.length > 0) {
          await pool.query(
            `DELETE FROM car_bookings WHERE id != $1 AND license = $2 AND selected_date = $3 AND status = 'pending'`,
            [record.id, record.license, record.selected_date]
          );
          for (const d of dupes.rows) {
            sendTeamsNotification('auto_cancel_duplicate', { ...d, reason: `มีการใช้รถจริงในวันเดียวกัน (Ticket ID: ${record.id})` }).catch(() => {});
          }
        }
        break;
      } else {
        const activeBorrowDate = new Date(activeBooking.selected_date);
        activeBorrowDate.setHours(0, 0, 0, 0);
        const pendingDate = new Date(record.selected_date);
        pendingDate.setHours(0, 0, 0, 0);

        if (!activeBooking.return_date && pendingDate >= activeBorrowDate) {
          console.log('[processBookingStatuses] Cancelling pending booking:', {
            pendingId: record.id,
            pendingStatus: record.status,
            pendingDate: pendingDate.toISOString(),
            activeBookingId: activeBooking.id,
            activeBorrowDate: activeBorrowDate.toISOString(),
            reason: 'รถยังไม่ถูกคืนจากการใช้งานก่อนหน้า'
          });
          
          // ลบเฉพาะการจอง pending เท่านั้น ไม่ลบ active
          const deleteResult = await pool.query(
            'DELETE FROM car_bookings WHERE id = $1 AND status = $2 RETURNING id', 
            [record.id, 'pending']
          );
          
          if (deleteResult.rows.length > 0) {
            console.log('[processBookingStatuses] Successfully deleted pending booking:', record.id);
            sendTeamsNotification('overdue_cancel', {
              ...record,
              cancellation_reason: `รถยังไม่ถูกคืนจากการใช้งานก่อนหน้า (ใช้งานตั้งแต่ ${activeBorrowDate.toLocaleDateString('th-TH')})`
            }).catch(() => {});
          } else {
            console.warn('[processBookingStatuses] No pending booking deleted (may already be active or deleted):', record.id);
          }
        }
      }
    }
  } catch (error) {
    console.error('processBookingStatuses error:', error);
  }
}

// Get all car booking records (lightweight - just fetch data)
router.get('/', async (req, res) => {
  try {
    await setTimezone();

    // Fire-and-forget: process status updates in background
    processBookingStatuses().catch(() => {});

    const result = await pool.query(`
      SELECT 
        c.id, c.type, c.location, c.project, c.task_id, c.discription, c.selected_date, c.time, c.license, 
        c.return_name, c.return_location, c.colleagues, c.created_at, c.updated_at,
        c.return_time, c.return_date, c.status, c.user_id, c.fuel_level_borrow, c.fuel_level_return,
        c.easy_pass_borrow, c.easy_pass_return,
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
    res.status(500).json({ error: error.message });
  }
});



// Get images for a specific booking
router.get('/:id/images', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT images FROM car_bookings WHERE id = $1', [id]);
    res.json(result.rows[0]?.images || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create car booking record
router.post('/', async (req, res) => {
  const { 
    type, location, task_id, description,
    selected_date, time, license, colleagues, images, user_id, fuel_level_borrow, easy_pass_borrow
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
    
    const result = await pool.query(`
      INSERT INTO car_bookings (
        type, location, project, task_id, discription,
        selected_date, time, license, colleagues, images, user_id, status, fuel_level_borrow, easy_pass_borrow
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
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
      user_id,
      'pending',
      fuel_level_borrow || null,
      easy_pass_borrow || null
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
    res.status(500).json({ error: error.message });
  }
});

// Update car booking record
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { images, return_name, return_location, return_description, return_time, return_date, fuel_level_return, easy_pass_return } = req.body;
  
  try {
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
    res.status(500).json({ error: error.message });
  }
});

// Delete car booking record
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
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
    res.status(500).json({ error: error.message });
  }
});

export default router;
