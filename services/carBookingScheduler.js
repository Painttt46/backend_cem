import cron from 'node-cron';
import pool from '../config/database.js';
import fetch from 'node-fetch';

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
    }
  } catch (error) {
    console.error('Teams notification error:', error);
  }
}

function createCarBookingMessage(type, data) {
  const currentTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  let title, color, tableData;

  switch (type) {
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
      return null;
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
    msteams: { width: "Full" }
  };
}

let isRunning = false;

async function checkAndUpdateBookingStatus() {
  if (isRunning) {
    return;
  }
  
  isRunning = true;
  try {
      await pool.query("SET timezone = 'Asia/Bangkok'");
      
      const result = await pool.query(`
        SELECT 
          c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
          c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
          c.return_time, c.return_date, c.status, c.user_id,
          u.firstname || ' ' || u.lastname as name
        FROM car_bookings c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.status IN ('pending', 'active')
        ORDER BY c.selected_date, c.time
      `);
      
      const now = new Date();
      const activeBooking = result.rows.find(r => r.status === 'active');
      
      // Cancel pending bookings that conflict with active booking
      if (activeBooking) {
        const activeBorrowDate = new Date(activeBooking.selected_date);
        activeBorrowDate.setHours(0, 0, 0, 0);
        
        const conflictingPending = result.rows.filter(record => {
          if (record.status !== 'pending') return false;
          
          const pendingDate = new Date(record.selected_date);
          pendingDate.setHours(0, 0, 0, 0);
          const [pendingHour, pendingMin] = record.time.split(':').map(Number);
          const pendingDateTime = new Date(record.selected_date);
          pendingDateTime.setHours(pendingHour, pendingMin, 0, 0);
          
          // Cancel if:
          // 1. Pending booking time has arrived (pendingDateTime <= now)
          // 2. Active booking is not returned yet (!activeBooking.return_date)
          // 3. Pending booking date is same or after active booking date
          const isPendingTimeArrived = pendingDateTime <= now;
          const isActiveNotReturned = !activeBooking.return_date;
          const isPendingAfterOrSameAsActive = pendingDate >= activeBorrowDate;
          
          return isPendingTimeArrived && isActiveNotReturned && isPendingAfterOrSameAsActive;
        });
        
        for (const pending of conflictingPending) {
          await pool.query('DELETE FROM car_bookings WHERE id = $1', [pending.id]);
          await sendTeamsNotification('overdue_cancel', {
            ...pending,
            cancellation_reason: `รถยังไม่ถูกคืนจากการใช้งานก่อนหน้า`
          });
        }
      }
      
      // Activate pending bookings whose time has arrived
      for (const record of result.rows) {
        if (record.status === 'pending') {
          const borrowDate = new Date(record.selected_date);
          const [hour, minute] = record.time.split(':').map(Number);
          const borrowDateTime = new Date(borrowDate);
          borrowDateTime.setHours(hour, minute, 0, 0);
          
          if (now >= borrowDateTime && !activeBooking) {
            await pool.query('UPDATE car_bookings SET status = $1 WHERE id = $2', ['active', record.id]);
            await sendTeamsNotification('active', record);
            
            // Delete duplicate bookings for same date
            const duplicates = await pool.query(`
              SELECT c.id, c.type, c.location, c.project, c.discription, c.selected_date, c.time, c.license, 
                     c.return_name, c.return_location, c.colleagues, c.images, c.created_at, c.updated_at,
                     c.return_time, c.return_date, c.status, c.user_id,
                     u.firstname || ' ' || u.lastname as name
              FROM car_bookings c
              LEFT JOIN users u ON c.user_id = u.id
              WHERE c.id != $1 AND c.license = $2 AND c.selected_date = $3 AND c.status = 'pending'
            `, [record.id, record.license, record.selected_date]);
            
            for (const dup of duplicates.rows) {
              await pool.query('DELETE FROM car_bookings WHERE id = $1', [dup.id]);
              await sendTeamsNotification('auto_cancel_duplicate', {
                ...dup,
                reason: `มีการใช้รถจริงในวันเดียวกัน (Ticket ID: ${record.id})`
              });
            }
            
            break;
          }
        }
      }
  } catch (error) {
    console.error('[Scheduler] Error:', error);
  } finally {
    isRunning = false;
  }
}

export function startCarBookingScheduler() {
  // Run every 5 seconds
  cron.schedule('*/5 * * * * *', async () => {
    await checkAndUpdateBookingStatus();
  });
  
}
