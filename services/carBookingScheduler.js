import cron from 'node-cron';
import { sendCarBookingTeamsNotification as sendTeamsNotification } from './carBookingTeams.js';
import pool from '../config/database.js';

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
          c.expected_return_date, c.expected_return_time, c.auto_returned,
          u.firstname || ' ' || u.lastname as name
        FROM car_bookings c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.status IN ('pending', 'active')
        ORDER BY c.selected_date, c.time
      `);

      const now = new Date();
      let activeBooking = result.rows.find(r => r.status === 'active');

      // Auto-return: active booking ที่ถึงเวลาคืนที่ตั้งไว้ตอนจอง → ปิดรายการให้เอง
      // ปลดล็อกรถให้คนถัดไปจองได้ทันที ไม่ต้องมาคอยแจ้งคืน (Teams จะแจ้งแทน)
      if (activeBooking && activeBooking.expected_return_time) {
        const expBase = new Date(activeBooking.expected_return_date || activeBooking.selected_date);
        const [eh, em] = String(activeBooking.expected_return_time).split(':').map(Number);
        const expDateTime = new Date(expBase);
        expDateTime.setHours(eh, em, 0, 0);

        if (now >= expDateTime) {
          const expDateStr = `${expBase.getFullYear()}-${String(expBase.getMonth() + 1).padStart(2, '0')}-${String(expBase.getDate()).padStart(2, '0')}`;
          await pool.query(`
            UPDATE car_bookings
            SET status = 'returned',
                return_time = $1,
                return_date = $2,
                return_name = $3,
                return_location = $4,
                auto_returned = true,
                updated_at = NOW()
            WHERE id = $5 AND status = 'active'
          `, [
            activeBooking.expected_return_time,
            expDateStr,
            activeBooking.name || 'ไม่ระบุ',
            `${activeBooking.location || 'ไม่ระบุ'} (คืนอัตโนมัติตามเวลา)`,
            activeBooking.id
          ]);
          console.log(`[Scheduler] Auto-returned booking #${activeBooking.id} at expected time ${activeBooking.expected_return_time}`);
          sendTeamsNotification('auto_return', {
            ...activeBooking,
            return_time: activeBooking.expected_return_time
          });
          // active state เปลี่ยนแล้ว — ไม่ใช้ค่าเก่าไปตัดสิน pending ใน tick นี้
          activeBooking = null;
        }
      }
      
      // Cancel pending bookings that conflict with active booking (เทียบทะเบียนรถเดียวกันเท่านั้น)
      if (activeBooking) {
        const activeBorrowDate = new Date(activeBooking.selected_date);
        activeBorrowDate.setHours(0, 0, 0, 0);
        
        const conflictingPending = result.rows.filter(record => {
          if (record.status !== 'pending') return false;
          if (record.license !== activeBooking.license) return false; // กันยกเลิกข้ามคันรถ
          
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
          // เก็บประวัติไว้ — ยกเลิกแทนการลบถาวร
          await pool.query(`UPDATE car_bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [pending.id]);
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
              await pool.query(`UPDATE car_bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'pending'`, [dup.id]);
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
