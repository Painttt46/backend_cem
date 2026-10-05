import fetch from 'node-fetch';
import { TEAMS_WEBHOOKS } from '../config/teams.js';

// การ์ดแจ้งเตือน Teams ของระบบจองรถ — รวมจาก routes/car_booking.js และ services/carBookingScheduler.js
// ที่เคยมีสำเนาของตัวเองสองชุด (35 บล็อกซ้ำ) ชนิดข้อความ: booking, active, return, cancel, overdue_cancel,
// auto_cancel, auto_cancel_duplicate, auto_return

function createCarBookingMessage(type, data) {
  const currentTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
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
    case 'auto_return':
      title = '⏱️ คืนรถอัตโนมัติ — ครบเวลาที่กำหนดตอนจอง';
      color = 'Good';
      tableData = [
        ['Ticket ID', data.id.toString()],
        ['ผู้ใช้', data.name || 'ไม่ระบุ'],
        ['โครงการ', data.project || 'ไม่ระบุ'],
        ['ทะเบียนรถ', data.license || 'ไม่ระบุ'],
        ['วันที่ใช้', data.selected_date ? new Date(data.selected_date).toLocaleDateString('th-TH') : 'ไม่ระบุ'],
        ['เวลารับรถ', data.time || 'ไม่ระบุ'],
        ['เวลาคืน (อัตโนมัติ)', data.return_time || 'ไม่ระบุ'],
        ['สถานะ', 'คืนรถแล้ว — รถพร้อมให้จองได้']
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

export { createCarBookingMessage };

export async function sendCarBookingTeamsNotification(type, data) {
  const webhookUrl = TEAMS_WEBHOOKS.car;

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
