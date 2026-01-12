import express from 'express';
import pool from '../config/database.js';
import fetch from 'node-fetch';

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

// Get latest fuel level from last returned booking
router.get('/latest-fuel', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT fuel_level_return 
      FROM car_bookings 
      WHERE status = 'returned' AND fuel_level_return IS NOT NULL
      ORDER BY updated_at DESC 
      LIMIT 1
    `);
    res.json({ fuel_level: result.rows[0]?.fuel_level_return || 50 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all car booking records with status calculation
router.get('/', async (req, res) => {
  try {
    await setTimezone();
    const result = await pool.query(`
      SELECT 
        c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
        c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
        c.return_time, c.return_date, c.status, c.user_id, c.fuel_level_borrow, c.fuel_level_return,
        u.firstname || ' ' || u.lastname as name
      FROM car_bookings c
      LEFT JOIN users u ON c.user_id = u.id
      ORDER BY c.created_at DESC
    `);
    
    // Update status based on current time with automatic cancellation
    const now = new Date();
    const updatedRecords = [];
    
    // Find active booking
    const activeBooking = result.rows.find(record => record.status === 'active');
    
    // Check for pending bookings that should be cancelled due to overdue active bookings
    if (activeBooking) {
      const activeBorrowDate = new Date(activeBooking.selected_date);
      activeBorrowDate.setHours(0, 0, 0, 0);
      const activeReturnDate = activeBooking.return_date ? new Date(activeBooking.return_date) : null;
      const now = new Date();
      
      // Find pending bookings that conflict with active booking
      const conflictingPending = result.rows.filter(record => {
        if (record.status !== 'pending') return false;
        
        const pendingDate = new Date(record.selected_date);
        pendingDate.setHours(0, 0, 0, 0);
        const pendingTime = record.time; // Format: "HH:MM"
        const [pendingHour, pendingMin] = pendingTime.split(':').map(Number);
        const pendingDateTime = new Date(record.selected_date);
        pendingDateTime.setHours(pendingHour, pendingMin, 0, 0);
        
        // Cancel if:
        // 1. Pending booking time has arrived (pendingDateTime <= now)
        // 2. Active booking is still not returned (!activeReturnDate)
        // 3. Pending booking date is same or after active booking date
        const isPendingTimeArrived = pendingDateTime <= now;
        const isActiveStillUsing = !activeReturnDate;
        const isPendingAfterOrSameAsActive = pendingDate >= activeBorrowDate;
        
        return isPendingTimeArrived && isActiveStillUsing && isPendingAfterOrSameAsActive;
      });
      
      if (conflictingPending.length > 0) {
        
        // Cancel conflicting pending bookings
        for (const pendingBooking of conflictingPending) {
          // Get booking data before deletion for Teams notification
          const cancelledBooking = await pool.query(`
            SELECT 
              c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
              c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
              c.return_time, c.return_date, c.status, c.user_id,
              u.firstname || ' ' || u.lastname as name
            FROM car_bookings c
            LEFT JOIN users u ON c.user_id = u.id
            WHERE c.id = $1
          `, [pendingBooking.id]);
          
          // Delete the pending booking
          await pool.query('DELETE FROM car_bookings WHERE id = $1', [pendingBooking.id]);
          
          // Send cancellation notification with reason
          if (cancelledBooking.rows.length > 0) {
            const bookingData = cancelledBooking.rows[0];
            bookingData.cancellation_reason = `รถยังไม่ถูกคืนจากการใช้งานก่อนหน้า (ใช้งานตั้งแต่ ${activeBorrowDate.toLocaleDateString('th-TH')} ${activeReturnDate ? 'ควรคืนวันที่ ' + activeReturnDate.toLocaleDateString('th-TH') : 'ไม่ได้กำหนดวันคืน'})`;
            await sendTeamsNotification('overdue_cancel', bookingData);
          }
          
          console.log(`Pending booking ${pendingBooking.id} cancelled due to overdue active booking`);
        }
        
        // Remove cancelled bookings from results
        result.rows = result.rows.filter(record => 
          record.status !== 'pending' || !conflictingPending.find(cb => cb.id === record.id)
        );
      }
    }
    
    for (const record of result.rows) {
      if (record.status === 'pending') {
        const borrowDate = new Date(record.selected_date);
        const [hour, minute] = record.time.split(':').map(Number);
        const borrowDateTime = new Date(borrowDate);
        borrowDateTime.setHours(hour, minute, 0, 0);
        
        if (now >= borrowDateTime) {
          if (!activeBooking) {
            // No active booking, can activate this one
            await pool.query('UPDATE car_bookings SET status = $1 WHERE id = $2', ['active', record.id]);
            record.status = 'active';
            
            // Send active notification
            await sendTeamsNotification('active', record);
            
            // Get and delete any other pending bookings for the same date and license
            const conflictingBookings = await pool.query(`
              SELECT 
                c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
                c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
                c.return_time, c.return_date, c.status, c.user_id,
                u.firstname || ' ' || u.lastname as name
              FROM car_bookings c
              LEFT JOIN users u ON c.user_id = u.id
              WHERE c.id != $1 
              AND c.license = $2 
              AND c.selected_date = $3 
              AND c.status = 'pending'
            `, [record.id, record.license, record.selected_date]);
            
            // Delete conflicting bookings
            if (conflictingBookings.rows.length > 0) {
              await pool.query(`
                DELETE FROM car_bookings 
                WHERE id != $1 
                AND license = $2 
                AND selected_date = $3 
                AND status = 'pending'
              `, [record.id, record.license, record.selected_date]);
              
              // Send notification for each cancelled booking
              for (const cancelled of conflictingBookings.rows) {
                await sendTeamsNotification('auto_cancel_duplicate', {
                  ...cancelled,
                  reason: `มีการใช้รถจริงในวันเดียวกัน (Ticket ID: ${record.id})`
                });
              }
            }
            
          } else {
            // Check if active booking conflicts with this pending booking
            const activeBorrowDate = new Date(activeBooking.selected_date);
            activeBorrowDate.setHours(0, 0, 0, 0);
            const pendingBorrowDate = new Date(borrowDate);
            pendingBorrowDate.setHours(0, 0, 0, 0);
            const activeReturnDate = activeBooking.return_date ? new Date(activeBooking.return_date) : null;
            
            // Conflict if:
            // 1. Active booking is not returned yet AND
            // 2. Pending booking date is same or after active booking date
            const isPendingAfterOrSameAsActive = pendingBorrowDate >= activeBorrowDate;
            const hasConflict = !activeReturnDate && isPendingAfterOrSameAsActive;
            
            if (hasConflict) {
              // Get booking data before deletion for Teams notification
              const cancelledBooking = await pool.query(`
                SELECT 
                  c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
                  c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
                  c.return_time, c.return_date, c.status, c.user_id,
                  u.firstname || ' ' || u.lastname as name
                FROM car_bookings c
                LEFT JOIN users u ON c.user_id = u.id
                WHERE c.id = $1
              `, [record.id]);
              
              // Cancel this booking due to conflict with active booking
              await pool.query('DELETE FROM car_bookings WHERE id = $1', [record.id]);
              
              // Send auto-cancel notification
              if (cancelledBooking.rows.length > 0) {
                await sendTeamsNotification('auto_cancel', {
                  ...cancelledBooking.rows[0],
                  reason: `มีรถกำลังใช้งานอยู่ (Ticket ID: ${activeBooking.id}) จนถึงวันที่จอง`
                });
              }
              
              console.log(`Booking ${record.id} cancelled due to active booking conflict (active until ${activeReturnDate || 'unknown'})`);
              continue; // Skip adding deleted record to results
            } else {
              // No conflict, can activate this booking
              await pool.query('UPDATE car_bookings SET status = $1 WHERE id = $2', ['active', record.id]);
              record.status = 'active';
              
              // Send active notification
              await sendTeamsNotification('active', record);
              
              // Get and delete any other pending bookings for the same date and license
              const conflictingBookings = await pool.query(`
                SELECT 
                  c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
                  c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
                  c.return_time, c.return_date, c.status, c.user_id,
                  u.firstname || ' ' || u.lastname as name
                FROM car_bookings c
                LEFT JOIN users u ON c.user_id = u.id
                WHERE c.id != $1 
                AND c.license = $2 
                AND c.selected_date = $3 
                AND c.status = 'pending'
              `, [record.id, record.license, record.selected_date]);
              
              // Delete conflicting bookings
              if (conflictingBookings.rows.length > 0) {
                await pool.query(`
                  DELETE FROM car_bookings 
                  WHERE id != $1 
                  AND license = $2 
                  AND selected_date = $3 
                  AND status = 'pending'
                `, [record.id, record.license, record.selected_date]);
                
                // Send notification for each cancelled booking
                for (const cancelled of conflictingBookings.rows) {
                  await sendTeamsNotification('auto_cancel_duplicate', {
                    ...cancelled,
                    reason: `มีการใช้รถจริงในวันเดียวกัน (Ticket ID: ${record.id})`
                  });
                }
              }
            }
            continue; // Skip adding to results
          }
        }
      }
      updatedRecords.push(record);
    }
    
    res.json(updatedRecords);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create car booking record
router.post('/', async (req, res) => {
  const { 
    type, location, project, description,
    selected_date, time, license, colleagues, images, user_id, fuel_level_borrow
  } = req.body;
  
  try {
    await setTimezone();
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
        type, location, project, discription,
        selected_date, time, license, colleagues, images, user_id, status, fuel_level_borrow
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
      RETURNING *
    `, [
      type, 
      location || '', 
      project || '', 
      description || '',
      selected_date, 
      time || '09:00', 
      license || 'FXAG-2032', 
      JSON.stringify(colleagues || []),
      JSON.stringify(images || []),
      user_id,
      'pending',
      fuel_level_borrow || null
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
    
    res.status(201).json(bookingData);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update car booking record
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { images, return_name, return_location, return_description, return_time, return_date, fuel_level_return } = req.body;
  
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
        SET return_name = $1, return_location = $2, discription = $3, return_time = $4, return_date = $5, images = $6, fuel_level_return = $7, status = 'returned', updated_at = NOW() 
        WHERE id = $8 
        RETURNING *
      `;
      params = [return_name, return_location, return_description, return_time, return_date, JSON.stringify(mergedImages), fuel_level_return || null, id];
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
    
    const result = await pool.query(`
      DELETE FROM car_bookings WHERE id = $1 RETURNING *
    `, [id]);
    
    // Send cancel notification
    await sendTeamsNotification('cancel', beforeDelete.rows[0]);
    
    // Return the data with user info for Teams notification
    res.json(beforeDelete.rows[0]);
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
