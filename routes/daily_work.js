import express from 'express';
import { postToTeams } from '../utils/teamsWebhook.js';
import { hasPermissionSafe } from '../utils/permissions.js';
import { PERM_DAILY_MANAGE_ALL } from '../config/permissionKeys.js';
import { TEAMS_WEBHOOKS } from '../config/teams.js';
import pool from '../config/database.js';
import fetch from 'node-fetch';
import { logAudit } from '../utils/auditHelper.js';
import { removeFilesIfUnreferenced } from '../utils/fileCleanup.js';
import { checkEntryDate, getEntryWindow } from '../utils/entryWindow.js';

const router = express.Router();

// คำนวณชั่วโมงทำงานจากเวลาเริ่ม/จบ ("HH:MM" หรือ "HH:MM:SS") ให้ตรงกับสูตรที่หน้าลงงานใช้ตอนสร้างรายการ:
// - ข้ามเที่ยงคืนได้ (เวลาจบน้อยกว่าเวลาเริ่ม = วันถัดไป)
// - หักพักเที่ยง 12:00–13:00 เมื่อช่วงงานคร่อมเวลานั้น
const calcTotalHours = (startTime, endTime) => {
  const toMinutes = (t) => {
    const [h, m] = String(t || '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const s = toMinutes(startTime);
  let e = toMinutes(endTime);
  if (s === null || e === null) return 0;
  if (e <= s) e += 24 * 60;
  let minutes = e - s;
  // พักเที่ยง: หักส่วนที่ทับกับ 12:00–13:00 (นับเฉพาะวันแรก เหมือนฝั่งหน้าเว็บ)
  const overlap = Math.min(e, 13 * 60) - Math.max(s, 12 * 60);
  if (s < 13 * 60 && e > 12 * 60 && overlap > 0) minutes -= overlap;
  return Math.max(0, Math.round((minutes / 60) * 100) / 100);
};

// เช็คสิทธิ์แก้ไข/ลบ daily work record: เจ้าของ record หรือ role ที่มีสิทธิ์บริหารเท่านั้น
async function canManageDailyWork(req, id) {
  const result = await pool.query(`SELECT user_id, TO_CHAR(work_date, 'YYYY-MM-DD') AS work_date FROM daily_work_records WHERE id = $1`, [id]);
  if (!result.rows.length) return { found: false, allowed: false };
  const isPrivileged = await hasPermissionSafe(req.user, PERM_DAILY_MANAGE_ALL);
  const isOwner = String(result.rows[0].user_id) === String(req.user?.id);
  return { found: true, allowed: isPrivileged || isOwner, record: result.rows[0] };
}

// ===== Microsoft Graph: สร้างนัดใน Outlook Calendar (+ Teams meeting) =====
// เดิม: ทุกขั้นตอนที่พลาด (ไม่ได้ตั้งค่า Azure, ขอ token ไม่ได้, Graph ตอบ error) แค่ console.error แล้ว return เงียบ ๆ
// route จึง log "[CALENDAR] Created successfully" เสมอ และผู้ใช้ไม่เคยรู้ว่าไม่ได้นัด → ตอนนี้คืนผลจริง + เหตุผลภาษาไทย
const GRAPH_BASE = () => process.env.GRAPH_BASE_URL || 'https://graph.microsoft.com/v1.0';
const AZURE_AUTHORITY = () => process.env.AZURE_AUTHORITY_HOST || 'https://login.microsoftonline.com';
const GRAPH_TIMEOUT_MS = 20000;
let graphTokenCache = { token: null, expiresAt: 0 };

// ข้อความ error ของ Azure AD / Graph → เหตุผลที่ผู้ดูแลแก้ต่อได้
function explainGraphError(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || {});
  if (/AADSTS7000222/.test(text)) return 'Client secret ของแอป Azure หมดอายุแล้ว — ต้องสร้าง secret ใหม่ใน Azure Portal แล้วใส่ AZURE_CLIENT_SECRET';
  if (/AADSTS7000215/.test(text)) return 'AZURE_CLIENT_SECRET ไม่ถูกต้อง (ต้องใช้ค่า "Value" ของ secret ไม่ใช่ Secret ID)';
  if (/AADSTS700016/.test(text)) return 'ไม่พบแอปตาม AZURE_CLIENT_ID ใน tenant นี้';
  if (/AADSTS90002|AADSTS900023/.test(text)) return 'AZURE_TENANT_ID ไม่ถูกต้อง';
  if (/ErrorItemNotFound|MailboxNotEnabledForRESTAPI|ResourceNotFound|UserNotFound/i.test(text)) return 'ไม่พบกล่องจดหมาย Microsoft 365 ของอีเมลผู้ใช้นี้ (อีเมลในระบบต้องเป็นบัญชี Microsoft 365 ของบริษัท)';
  if (status === 403 || /ErrorAccessDenied|Authorization_RequestDenied/i.test(text)) return 'แอป Azure ไม่มีสิทธิ์ Calendars.ReadWrite (Application) หรือยังไม่ได้ Grant admin consent / ถูกจำกัดด้วย Application Access Policy';
  if (status === 401) return 'token ไม่ถูกต้อง/หมดอายุ';
  if (status === 400) return `ข้อมูลนัดไม่ถูกต้อง (${(text.match(/"message":"([^"]+)"/) || [])[1] || 'Bad Request'})`;
  return `Microsoft Graph ตอบ HTTP ${status}`;
}

// Function to get access token for Microsoft Graph API (client credentials) — cache ไว้จนใกล้หมดอายุ
async function getAccessToken() {
  if (graphTokenCache.token && Date.now() < graphTokenCache.expiresAt) return { token: graphTokenCache.token };

  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_TENANT_ID;
  const missing = [['AZURE_CLIENT_ID', clientId], ['AZURE_CLIENT_SECRET', clientSecret], ['AZURE_TENANT_ID', tenantId]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { error: `ยังไม่ได้ตั้งค่า ${missing.join(', ')} ใน environment ของ backend` };

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('grant_type', 'client_credentials');

  try {
    const response = await fetch(`${AZURE_AUTHORITY()}/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      console.error('[CALENDAR] ขอ token จาก Azure ไม่สำเร็จ:', response.status, data.error, (data.error_description || '').split('\n')[0]);
      return { error: explainGraphError(response.status, data) };
    }
    graphTokenCache = { token: data.access_token, expiresAt: Date.now() + Math.max(0, (Number(data.expires_in) || 3600) - 300) * 1000 };
    return { token: data.access_token };
  } catch (error) {
    console.error('[CALENDAR] เชื่อมต่อ Azure ไม่ได้:', error.cause?.code || error.name, error.message);
    return { error: `เชื่อมต่อ login.microsoftonline.com ไม่ได้ (${error.cause?.code || error.name}) — ตรวจอินเทอร์เน็ตขาออกของ server` };
  }
}

// สร้างนัด — คืน { ok: true, eventId, joinUrl } หรือ { ok: false, error }
async function sendCalendarEvent(data) {
  try {
    const hhmm = (t) => String(t || '').slice(0, 5);
    const startDateTime = `${data.work_date}T${hhmm(data.start_time)}:00`;
    const endDateTime = `${data.work_date}T${hhmm(data.end_time)}:00`;

    // Get user's email from database
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [data.user_id]);
    const userEmail = userResult.rows.length > 0 ? userResult.rows[0].email : null;
    if (!userEmail) return { ok: false, error: 'ผู้ใช้ไม่มีอีเมลในระบบ — ต้องใส่อีเมล Microsoft 365 ในข้อมูลผู้ใช้ก่อน' };

    const { token: accessToken, error: tokenError } = await getAccessToken();
    if (!accessToken) return { ok: false, error: tokenError };

    // Prepare attendees — creator เป็น attendee แรกเสมอ
    const attendees = [{ emailAddress: { address: userEmail, name: data.user_name }, type: 'required' }];
    (data.attendees || []).forEach(attendee => {
      const email = typeof attendee === 'string' ? attendee : attendee?.email;
      const name = typeof attendee === 'string' ? attendee : (attendee?.name || attendee?.email);
      if (email && email.toLowerCase() !== userEmail.toLowerCase()) {
        attendees.push({ emailAddress: { address: email, name }, type: 'required' });
      }
    });

    const nl = s => (s || '').replace(/\n/g, '<br>');
    let html = `<p><strong>👤 ผู้ปฏิบัติงาน:</strong> ${data.user_name}</p>`;
    html += `<p><strong>📍 สถานที่:</strong> ${data.location || 'ไม่ระบุ'}</p>`;
    html += `<p><strong>📝 รายละเอียด:</strong><br>${nl(data.work_description)}</p>`;
    if (data.event_details) html += `<hr><p><strong>📋 Steps:</strong><br>${nl(data.event_details)}</p>`;

    // dateTime ต้องไม่มี offset เมื่อระบุ timeZone แยก (ตามรูปแบบ dateTimeTimeZone ของ Graph)
    const calendarEvent = {
      subject: data.task_name,
      body: { contentType: 'HTML', content: html },
      start: { dateTime: startDateTime, timeZone: 'SE Asia Standard Time' },
      end: { dateTime: endDateTime, timeZone: 'SE Asia Standard Time' },
      location: { displayName: data.location || '' },
      attendees
    };
    if (data.create_teams_meeting === true) {
      calendarEvent.isOnlineMeeting = true;
      calendarEvent.onlineMeetingProvider = 'teamsForBusiness';
    }

    const response = await fetch(`${GRAPH_BASE()}/users/${encodeURIComponent(userEmail)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify(calendarEvent),
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
    });
    const responseText = await response.text();
    if (!response.ok) {
      if (response.status === 401) graphTokenCache = { token: null, expiresAt: 0 };
      console.error('[CALENDAR] Graph สร้างนัดไม่สำเร็จ:', response.status, responseText.slice(0, 500));
      return { ok: false, error: explainGraphError(response.status, responseText) };
    }
    let created = {};
    try { created = JSON.parse(responseText); } catch { /* ignore */ }
    const joinUrl = created.onlineMeeting?.joinUrl || null;
    if (data.create_teams_meeting === true && !joinUrl) {
      // สร้างนัดได้ แต่ Teams ไม่ได้แนบลิงก์ประชุม (เช่น บัญชีไม่มี license Teams) — แจ้งให้รู้
      return { ok: true, eventId: created.id, joinUrl: null, warning: 'สร้างนัดแล้ว แต่ไม่ได้ลิงก์ Teams Meeting (บัญชีอาจไม่มี license Teams)' };
    }
    return { ok: true, eventId: created.id, joinUrl };
  } catch (error) {
    console.error('[CALENDAR] Graph error:', error.cause?.code || error.name, error.message);
    return { ok: false, error: `เชื่อมต่อ Microsoft Graph ไม่ได้ (${error.cause?.code || error.name})` };
  }
}

// Teams notification function
async function sendTeamsNotification(type, data) {
  const webhookUrl = TEAMS_WEBHOOKS.dailyWork;

  try {
    const message = createDailyWorkMessage(type, data);
    await postToTeams(webhookUrl, message, { label: 'Daily work' });
  } catch (error) {
    console.error('Teams notification error:', error);
  }
}

// Send daily work summary to Teams
async function sendDailyWorkSummaryToTeams() {
  const webhookUrl = TEAMS_WEBHOOKS.workSummary;
  
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    
    // Get all work records for today grouped by user
    const result = await pool.query(`
      SELECT 
        d.id,
        d.user_id,
        u.firstname || ' ' || u.lastname as user_name,
        u.position,
        u.department,
        d.task_name,
        d.so_number,
        d.start_time,
        d.end_time,
        d.total_hours,
        d.work_status,
        d.location,
        d.work_description,
        d.submitted_at,
        d.updated_at,
        ts.step_name,
        TO_CHAR(ts.start_date, 'DD/MM/YY') as step_start_date,
        TO_CHAR(ts.end_date, 'DD/MM/YY') as step_end_date,
        (SELECT string_agg(u2.firstname || ' ' || u2.lastname, ', ')
         FROM jsonb_array_elements(ts.assigned_users) AS au
         JOIN users u2 ON u2.id = (au->>'id')::int) as step_assignees
      FROM daily_work_records d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN task_steps ts ON d.step_id = ts.id
      WHERE d.work_date = $1
      ORDER BY u.firstname, u.lastname, d.submitted_at
    `, [today]);

    if (result.rows.length === 0) return;

    // Find latest action record (by updated_at)
    const latestRecord = result.rows.reduce((max, row) => {
      const maxTime = new Date(max.updated_at || max.submitted_at);
      const rowTime = new Date(row.updated_at || row.submitted_at);
      return rowTime > maxTime ? row : max;
    });
    const latestId = latestRecord.id;
    const latestUserId = latestRecord.user_id;
    

    // Group by user
    const groupedByUser = {};
    for (const row of result.rows) {
      if (!groupedByUser[row.user_id]) {
        groupedByUser[row.user_id] = {
          userId: row.user_id,
          name: row.user_name,
          position: row.position || '',
          department: row.department || '',
          works: [],
          isLatestUser: row.user_id === latestUserId
        };
      }
      groupedByUser[row.user_id].works.push({
        id: row.id,
        task_name: row.task_name,
        so_number: row.so_number,
        step_name: row.step_name,
        step_start_date: row.step_start_date,
        step_end_date: row.step_end_date,
        step_assignees: row.step_assignees,
        start_time: row.start_time?.substring(0, 5) || '',
        end_time: row.end_time?.substring(0, 5) || '',
        total_hours: row.total_hours,
        work_status: row.work_status || '-',
        location: row.location,
        work_description: row.work_description,
        isLatest: row.id === latestId
      });
    }

    const currentTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const userCount = Object.keys(groupedByUser).length;

    // Sort users - latest user at bottom
    const sortedUsers = Object.values(groupedByUser).sort((a, b) => {
      if (a.isLatestUser) return 1;
      if (b.isLatestUser) return -1;
      return a.name.localeCompare(b.name);
    });

    // Build containers for each user
    const userContainers = sortedUsers.map(user => {
      const workItems = user.works.map(w => {
        const isCancelled = w.work_status === 'cancelled';
        const containerStyle = isCancelled ? "attention" : (user.isLatestUser ? "warning" : "default");
        const textColor = isCancelled ? "Attention" : (user.isLatestUser ? "Warning" : "Default");
        
        // Build items array
        const items = [
          { type: "TextBlock", text: `📋 ${w.task_name}${w.so_number ? ` (${w.so_number})` : ''}${w.isLatest ? ' ✨' : ''}`, weight: "Bolder", size: "Small", wrap: true, color: textColor },
          // Workflow step box
          ...(w.step_name ? [{
            type: "Container",
            style: "accent",
            items: [
              { type: "TextBlock", text: `⚙️ Step: ${w.step_name}${w.step_start_date ? ` | 📅 ${w.step_start_date}-${w.step_end_date}` : ''}${w.step_assignees ? ` | 👥 ${w.step_assignees}` : ''}`, size: "Small", wrap: true }
            ],
            spacing: "Small"
          }] : []),
          { type: "TextBlock", text: `⏰ ${w.start_time}-${w.end_time} (${w.total_hours} ชม.) | ${w.work_status}${w.location ? ` | 📍 ${w.location}` : ''}`, size: "Small", spacing: "Small", color: textColor },
          ...(w.work_description ? [{ type: "TextBlock", text: `📝 ${w.work_description}`, size: "Small", spacing: "None", wrap: true, isSubtle: true }] : [])
        ];
        
        return {
          type: "Container",
          style: containerStyle,
          items: items,
          spacing: "Small"
        };
      });

      return {
        type: "Container",
        style: user.isLatestUser ? "warning" : "emphasis",
        bleed: user.isLatestUser,
        items: [
          {
            type: "TextBlock",
            text: `👤 ${user.name}${user.isLatestUser ? ' 🆕' : ''}`,
            weight: "Bolder",
            size: "Medium",
            color: user.isLatestUser ? "Warning" : "Default"
          },
          {
            type: "TextBlock",
            text: `${user.position}${user.department ? ` - ${user.department}` : ''}`,
            size: "Small",
            isSubtle: !user.isLatestUser,
            spacing: "None"
          },
          ...workItems
        ],
        spacing: "Medium"
      };
    });

    const message = {
      type: "AdaptiveCard",
      version: "1.5",
      body: [
        {
          type: "TextBlock",
          text: "📊 สรุปการลงงานประจำวัน",
          size: "Large",
          weight: "Bolder",
          color: "Accent"
        },
        {
          type: "TextBlock",
          text: `📅 วันที่: ${new Date(today).toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
          size: "Small",
          spacing: "None"
        },
        {
          type: "TextBlock",
          text: `🕐 อัปเดตล่าสุด: ${currentTime} | พนักงานลงงานแล้ว: ${userCount} คน`,
          size: "Small",
          spacing: "None",
          isSubtle: true
        },
        ...userContainers
      ],
      msteams: { width: "Full" }
    };

    await postToTeams(webhookUrl, message, { label: 'Daily work summary' });
  } catch (error) {
    console.error('Daily work summary Teams error:', error);
  }
}

function createDailyWorkMessage(type, data) {
  const currentTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  switch (type) {
    case 'all_complete':
      return {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          {
            type: "TextBlock",
            text: "✅ แจ้งเตือน: ลงงานครบทุกคนแล้ว",
            size: "Medium",
            weight: "Bolder",
            color: "Good"
          },
          {
            type: "TextBlock",
            text: `เวลา: ${currentTime}`,
            size: "Small",
            color: "Default",
            spacing: "None"
          },
          {
            type: "TextBlock",
            text: `🎉 วันนี้พนักงานลงงานครบทุกคนแล้ว (${data.totalUsers} คน)`,
            size: "Medium",
            color: "Good",
            weight: "Bolder"
          }
        ],
        msteams: {
          width: "Full"
        }
      };

    case 'missing_work':
      const tableRows = data.missingUsers.map(user => ({
        type: "TableRow",
        cells: [
          {
            type: "TableCell",
            items: [{ type: "TextBlock", text: user.name, weight: "Bolder", wrap: true }]
          },
          {
            type: "TableCell",
            items: [{ type: "TextBlock", text: user.position || 'ไม่ระบุ', wrap: true }]
          },
          {
            type: "TableCell",
            items: [{ type: "TextBlock", text: user.department || 'ไม่ระบุ', wrap: true }]
          }
        ]
      }));

      return {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          {
            type: "TextBlock",
            text: "⚠️ แจ้งเตือน: พนักงานที่ยังไม่ได้ลงงานวันนี้",
            size: "Medium",
            weight: "Bolder",
            color: "Attention"
          },
          {
            type: "TextBlock",
            text: `เวลา: ${currentTime} (หลัง 10:00 น.)`,
            size: "Small",
            color: "Default",
            spacing: "None"
          },
          {
            type: "TextBlock",
            text: `จำนวนพนักงานที่ยังไม่ได้ลงงาน: ${data.missingUsers.length} คน`,
            size: "Small",
            color: "Attention",
            weight: "Bolder"
          },
          {
            type: "Table",
            columns: [{ width: 3 }, { width: 2 }, { width: 2 }],
            rows: [
              {
                type: "TableRow",
                cells: [
                  {
                    type: "TableCell",
                    items: [{ type: "TextBlock", text: "ชื่อ-นามสกุล", weight: "Bolder", color: "Accent" }]
                  },
                  {
                    type: "TableCell",
                    items: [{ type: "TextBlock", text: "ตำแหน่ง", weight: "Bolder", color: "Accent" }]
                  },
                  {
                    type: "TableCell",
                    items: [{ type: "TextBlock", text: "แผนก", weight: "Bolder", color: "Accent" }]
                  }
                ]
              },
              ...tableRows
            ]
          }
        ],
        msteams: {
          width: "Full"
        }
      };
  }
}

// Auto check missing work every minute (runs independently)
let checkInterval;

let lastNotificationDate = null;
let allCompleteNotified = false;
let allCompleteNotifiedDate = null;

function startAutoCheck() {
  // Clear existing interval
  if (checkInterval) {
    clearInterval(checkInterval);
  }

  // Check every minute after 9:30 AM
  checkInterval = setInterval(async () => {
    // Use Thailand timezone for time check
    const now = new Date();
    const bangkokTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
    const currentHour = bangkokTime.getHours();
    const currentMinute = bangkokTime.getMinutes();

    // Only check between 10:00 AM - 18:00 PM Thailand time
    if (currentHour >= 10 && currentHour < 18) {
      try {
        await checkAndNotifyMissingWork();
      } catch (error) {
        console.error('Auto check error:', error);
      }
    }
  }, 20 * 60 * 1000); // Every 20 minutes
}

async function checkAndNotifyMissingWork() {
  // Use Thailand timezone
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  // Reset notification flag if it's a new day
  if (lastNotificationDate !== today) {
    lastNotificationDate = today;
    allCompleteNotified = false;
    allCompleteNotifiedDate = null;
  }

  // Get all active engineers only
  const activeUsersResult = await pool.query(`
    SELECT id, firstname || ' ' || lastname as name, position, 
           COALESCE(department, 'ไม่ระบุ') as department 
    FROM users 
    WHERE (is_active IS NULL OR is_active = true) AND role = 'engineer'
  `);

  // Get users who have submitted work today
  const submittedUsersResult = await pool.query(`
    SELECT DISTINCT user_id 
    FROM daily_work_records 
    WHERE work_date = $1
  `, [today]);

  // Get users who have approved leave today
  const approvedLeaveResult = await pool.query(`
    SELECT DISTINCT user_id
    FROM leave_requests 
    WHERE status = 'approved' 
    AND start_datetime::date <= $1 
    AND end_datetime::date >= $1
  `, [today]);

  const submittedUserIds = submittedUsersResult.rows.map(row => row.user_id);
  const approvedLeaveUserIds = approvedLeaveResult.rows.map(row => row.user_id);
  const activeUsers = activeUsersResult.rows;

  // Debug logging

  // Find missing users
  const missingUsers = activeUsers.filter(user =>
    !submittedUserIds.includes(user.id) && !approvedLeaveUserIds.includes(user.id)
  );


  if (missingUsers.length > 0) {
    await sendTeamsNotification('missing_work', { missingUsers });
  } else if (activeUsers.length > 0 && allCompleteNotifiedDate !== today) {
    await sendTeamsNotification('all_complete', { totalUsers: activeUsers.length });
    allCompleteNotified = true;
    allCompleteNotifiedDate = today;
  } else {
  }
}

//Start auto check when server starts
startAutoCheck();
router.post('/check-missing', async (req, res) => {
  try {
    // Use Thailand timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

    // Get all active engineers only
    const activeUsersResult = await pool.query(`
      SELECT id, firstname || ' ' || lastname as name, position, 
             COALESCE(department, 'ไม่ระบุ') as department 
      FROM users 
      WHERE (is_active IS NULL OR is_active = true) AND role = 'engineer'
    `);

    // Get users who have submitted work today
    const submittedUsersResult = await pool.query(`
      SELECT DISTINCT user_id 
      FROM daily_work_records 
      WHERE work_date::date = $1::date
    `, [today]);

    // Get users who have approved leave today
    const approvedLeaveResult = await pool.query(`
      SELECT DISTINCT user_id
      FROM leave_requests 
      WHERE status = 'approved' 
      AND start_datetime::date <= $1 
      AND end_datetime::date >= $1
    `, [today]);

    const submittedUserIds = submittedUsersResult.rows.map(row => row.user_id);
    const approvedLeaveUserIds = approvedLeaveResult.rows.map(row => row.user_id);
    const activeUsers = activeUsersResult.rows;

    // Find missing users (exclude those with approved leave)
    const missingUsers = activeUsers.filter(user =>
      !submittedUserIds.includes(user.id) && !approvedLeaveUserIds.includes(user.id)
    );


    if (missingUsers.length > 0) {
      await sendTeamsNotification('missing_work', { missingUsers });
      res.json({ message: 'Missing work notification sent', missingCount: missingUsers.length });
    } else if (allCompleteNotifiedDate !== today) {
      await sendTeamsNotification('all_complete', { totalUsers: activeUsers.length });
      allCompleteNotifiedDate = today;
      res.json({ message: 'All complete notification sent', totalUsers: activeUsers.length });
    } else {
      res.json({ message: 'All complete notification already sent today', totalUsers: activeUsers.length });
    }
  } catch (error) {
    console.error('Error checking missing work:', error);
    res.status(500).json({ error: 'ไม่สามารถตรวจสอบงานที่ยังไม่ได้บันทึกได้' });
  }
});

//Get all daily work records with task details
router.get('/', async (req, res) => {
  try {
    const { date, task_id } = req.query;

    let query = `
      SELECT 
        dwr.id, dwr.task_id, dwr.step_id, dwr.step_ids,
        TO_CHAR(dwr.work_date, 'YYYY-MM-DD') as work_date,
        dwr.start_time, dwr.end_time, dwr.total_hours,
        dwr.work_status, dwr.location, dwr.work_description, dwr.files, dwr.submitted_at,
        dwr.created_at, dwr.updated_at, dwr.user_id,
        COALESCE(u.firstname || ' ' || u.lastname, 'ไม่ระบุ') as employee_name,
        COALESCE(u.position, 'ไม่ระบุ') as employee_position,
        COALESCE(u.department, 'ไม่ระบุ') as employee_department,
        t.task_name,
        t.so_number,
        t.customer_info,
        t.contract_number,
        t.sale_owner,
        COALESCE(t.category, 'งานทั่วไป') as category,
        ts.step_name,
        ts.description as step_description,
        ts.start_date as step_start_date,
        ts.end_date as step_end_date,
        ts.assigned_users as step_assigned_users,
        ts.status as step_status,
        ts.project_statuses as step_project_statuses,
        ts.step_order as step_order,
        (
          SELECT json_agg(json_build_object(
            'id', s.id,
            'step_name', s.step_name,
            'step_order', s.step_order,
            'status', s.status,
            'end_date', s.end_date,
            'project_statuses', s.project_statuses,
            'has_work_logged', EXISTS(SELECT 1 FROM daily_work_records d WHERE (d.step_id = s.id OR (d.step_ids IS NOT NULL AND (d.step_ids @> to_jsonb(s.id) OR d.step_ids @> to_jsonb(s.id::text)))) AND d.work_date <= CURRENT_DATE),
            'latest_work_date', (SELECT MAX(work_date) FROM daily_work_records d WHERE (d.step_id = s.id OR (d.step_ids IS NOT NULL AND (d.step_ids @> to_jsonb(s.id) OR d.step_ids @> to_jsonb(s.id::text)))) AND d.work_date <= CURRENT_DATE)
          ) ORDER BY s.step_order)
          FROM task_steps s
          WHERE s.id = ANY(
            CASE 
              WHEN dwr.step_ids IS NOT NULL AND jsonb_array_length(dwr.step_ids) > 0 
              THEN ARRAY(SELECT jsonb_array_elements_text(dwr.step_ids)::int)
              WHEN dwr.step_id IS NOT NULL THEN ARRAY[dwr.step_id]
              ELSE ARRAY[]::int[]
            END
          )
        ) as steps_data
      FROM daily_work_records dwr
      LEFT JOIN users u ON dwr.user_id = u.id
      LEFT JOIN tasks t ON dwr.task_id = t.id
      LEFT JOIN task_steps ts ON dwr.step_id = ts.id
    `;

    const params = [];
    const conditions = [];

    if (date) {
      conditions.push(`dwr.work_date = $${params.length + 1}`);
      params.push(date);
    }

    if (task_id) {
      conditions.push(`dwr.task_id = $${params.length + 1}`);
      params.push(task_id);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY dwr.work_date DESC, dwr.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching daily work records:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดข้อมูลงานประจำวันได้' });
  }
});

// สถานะการลงงานตอนนี้ (กติกา 10:00 / ห้ามย้อนหลัง) — หน้าลงงานใช้จำกัดวันที่และแจ้งเมื่อถูกปิดลงงาน
router.get('/entry-window', async (req, res) => {
  try {
    res.json(await getEntryWindow('daily_work', req.user));
  } catch (error) {
    console.error('Error checking daily work entry window:', error);
    res.status(500).json({ error: 'ไม่สามารถตรวจสอบเวลาลงงานได้' });
  }
});

// Create daily work record
router.post('/', async (req, res) => {
  const {
    task_id, step_id, step_ids, work_date, start_time, end_time, total_hours,
    location, work_description, files, user_id, submitted_at,
    create_calendar_event, event_title, meeting_start_time, meeting_end_time, 
    attendees, create_teams_meeting, meeting_room, event_details
  } = req.body;

  // ใช้ user_id จาก token เท่านั้น กันลงงานในนามผู้อื่น (IDOR)
  const ownerId = req.user?.id || user_id || null;

  // รองรับทั้ง step_id (single) และ step_ids (array)
  const finalStepIds = step_ids || (step_id ? [step_id] : [null]);

  // ดึง work_status จาก task.status
  let work_status = null;


  try {
    // ห้ามลงงานย้อนหลัง + รายการแรกของวันต้องลงก่อน 10:00 (ดู utils/entryWindow.js)
    const dateError = await checkEntryDate('daily_work', req.user, work_date, { ownerId });
    if (dateError) return res.status(400).json({ error: dateError, code: 'ENTRY_WINDOW' });

    // ดึง task_name จาก tasks table
    let task_name = null;
    let so_number = null;
    let contract_number = null;
    let sale_owner = null;

    if (task_id) {
      const taskResult = await pool.query('SELECT task_name, so_number, contract_number, sale_owner, status FROM tasks WHERE id = $1', [task_id]);
      if (taskResult.rows.length > 0) {
        task_name = taskResult.rows[0].task_name;
        so_number = taskResult.rows[0].so_number;
        contract_number = taskResult.rows[0].contract_number;
        sale_owner = taskResult.rows[0].sale_owner;
        work_status = taskResult.rows[0].status;
      }
    }

    const result = await pool.query(`
      INSERT INTO daily_work_records (
        task_id, step_id, step_ids, task_name, so_number, contract_number, sale_owner,
        work_date, start_time, end_time, total_hours,
        work_status, location, work_description, files, user_id, submitted_at
      ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17) 
      RETURNING *
    `, [
      task_id, finalStepIds[0], JSON.stringify(finalStepIds.filter(id => id !== null)), task_name, so_number, contract_number, sale_owner,
      work_date, start_time, end_time, total_hours,
      work_status, location, work_description, JSON.stringify(files || []), ownerId, submitted_at
    ]);

    // Auto-add user to assigned_users if not already assigned
    if (ownerId && finalStepIds.length > 0) {
      const userResult = await pool.query('SELECT id, firstname, lastname FROM users WHERE id = $1', [ownerId]);
      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        const userData = { id: user.id, name: `${user.firstname} ${user.lastname}` };
        
        for (const stepId of finalStepIds.filter(id => id !== null)) {
          const stepResult = await pool.query('SELECT assigned_users FROM task_steps WHERE id = $1', [stepId]);
          if (stepResult.rows.length > 0) {
            let assignedUsers = stepResult.rows[0].assigned_users || [];
            const isAssigned = assignedUsers.some(u => u.id === user.id);
            if (!isAssigned) {
              assignedUsers.push(userData);
              await pool.query('UPDATE task_steps SET assigned_users = $1::jsonb WHERE id = $2', 
                [JSON.stringify(assignedUsers), stepId]);
            }
          }
        }
      }
    }

    // Create calendar event if requested (ติ๊ก Teams Meeting อย่างเดียวก็ถือว่าต้องการนัด — Teams Meeting ต้องอยู่ในนัดเสมอ)
    let calendarResult = null;
    const wantsCalendar = (create_calendar_event || create_teams_meeting === true) && event_title;
    if (wantsCalendar && (meeting_start_time || start_time) && (meeting_end_time || end_time)) {
      const eventStartTime = meeting_start_time || start_time;
      const eventEndTime = meeting_end_time || end_time;
      console.log('[CALENDAR] Attempting:', { event_title, user_id: ownerId, work_date, eventStartTime, eventEndTime, teams: create_teams_meeting === true });

      const userResult = await pool.query('SELECT firstname, lastname FROM users WHERE id = $1', [ownerId]);
      const userName = userResult.rows.length > 0 ?
        `${userResult.rows[0].firstname} ${userResult.rows[0].lastname}` : 'ไม่ระบุ';

      calendarResult = await sendCalendarEvent({
        task_name: event_title,
        work_date,
        start_time: eventStartTime,
        end_time: eventEndTime,
        location,
        work_description,
        user_name: userName,
        user_id: ownerId,
        attendees: attendees || [],
        create_teams_meeting,
        event_details
      });
      if (calendarResult.ok) {
        console.log('[CALENDAR] Created:', { event_title, work_date, teams: !!calendarResult.joinUrl, warning: calendarResult.warning || undefined });
      } else {
        console.error('[CALENDAR] Failed:', { event_title, work_date, reason: calendarResult.error });
      }
    } else if (create_calendar_event || create_teams_meeting === true) {
      calendarResult = { ok: false, error: 'ไม่มีหัวข้อหรือเวลาของนัด จึงไม่ได้สร้างนัด' };
    }

    // Send Teams notification only if work_date is today
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    if (work_date === today) {
      try {
        await sendDailyWorkSummaryToTeams();
      } catch (teamsError) {
        console.error('Teams notification failed:', teamsError);
      }
    }

    // Log audit
    await logAudit(req, {
      action: 'CREATE',
      tableName: 'daily_work_records',
      recordId: result.rows[0].id,
      recordName: `${task_name || 'งาน'} - ${work_date}`,
      newData: { task_name, work_date, start_time, end_time, total_hours, location }
    });

    // calendar_event: ผลการสร้างนัด (หน้าเว็บแจ้งผู้ใช้เมื่อสร้างไม่สำเร็จ — งานยังบันทึกแล้ว)
    res.status(201).json(calendarResult
      ? { ...result.rows[0], calendar_event: { created: calendarResult.ok, error: calendarResult.error || null, warning: calendarResult.warning || null, teams_join_url: calendarResult.joinUrl || null } }
      : result.rows[0]);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'ไม่สามารถบันทึกงานประจำวันได้' });
  }
});

// Update daily work record
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { task_id, step_id, step_ids, work_date, start_time, end_time, work_status, location, work_description, files } = req.body;

    const { found, allowed, record } = await canManageDailyWork(req, id);
    if (!found) return res.status(404).json({ error: 'Daily work record not found' });
    if (!allowed) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์แก้ไขรายการนี้' });

    // แก้รายละเอียดได้เสมอ แต่ถ้าเปลี่ยนวันที่ ต้องผ่านกติกาเดียวกับการลงงานใหม่ (ห้ามย้ายไปวันที่ผ่านมาแล้ว)
    const dateError = await checkEntryDate('daily_work', req.user, work_date, { oldDate: record.work_date, ownerId: record.user_id });
    if (dateError) return res.status(400).json({ error: dateError, code: 'ENTRY_WINDOW' });

    // คำนวณ total_hours ด้วยสูตรเดียวกับตอนสร้างรายการ (หักพักเที่ยง) — เดิมแก้แล้วชั่วโมงเพี้ยนจากตอนสร้าง
    const total_hours = calcTotalHours(start_time, end_time);

    // step_ids: ถ้าหน้าเว็บส่งมาให้อัปเดตด้วย (เดิมอัปเดตแค่ step_id ทำให้รายการหลายขั้นตอนไม่ตรงกันหลังแก้ไข)
    // ไม่ส่งมา = คงค่าเดิม
    const hasStepIds = Array.isArray(step_ids);
    const finalStepIds = hasStepIds ? step_ids.filter(sid => sid !== null && sid !== undefined && sid !== '') : null;
    const finalStepId = hasStepIds && finalStepIds.length > 0 ? finalStepIds[0] : step_id;

    const result = await pool.query(`
      UPDATE daily_work_records
      SET task_id = $1, step_id = $2, work_date = $3, start_time = $4, end_time = $5, total_hours = $6,
          work_status = $7, location = $8, work_description = $9,
          files = $10::jsonb, step_ids = COALESCE($12::jsonb, step_ids), updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `, [task_id, finalStepId, work_date, start_time, end_time, total_hours, work_status, location, work_description, JSON.stringify(files || []), id, hasStepIds ? JSON.stringify(finalStepIds) : null]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Daily work record not found' });
    }

    // Send Teams notification only if work_date is today
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    if (work_date === today) {
      try {
        await sendDailyWorkSummaryToTeams();
      } catch (teamsError) {
        console.error('Teams notification failed:', teamsError);
      }
    }

    // Log audit
    await logAudit(req, {
      action: 'UPDATE',
      tableName: 'daily_work_records',
      recordId: parseInt(id),
      recordName: `งาน - ${work_date}`,
      newData: { work_date, start_time, end_time, work_status, location }
    });

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating daily work record:', error);
    res.status(500).json({ error: 'Failed to update daily work record' });
  }
});

// Delete daily work record
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { found, allowed } = await canManageDailyWork(req, id);
    if (!found) return res.status(404).json({ error: 'Daily work record not found' });
    if (!allowed) return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ลบรายการนี้' });

    // Get data before delete for audit and rollback
    const oldResult = await pool.query('SELECT * FROM daily_work_records WHERE id = $1', [id]);
    const oldData = oldResult.rows[0];

    if (oldData) {
      const userId = oldData.user_id;
      let stepIds = [];
      
      // รวบรวม step_ids ที่ต้อง rollback
      if (oldData.step_ids && oldData.step_ids.length > 0) {
        stepIds = oldData.step_ids;
      } else if (oldData.step_id) {
        stepIds = [oldData.step_id];
      }
      
      // ลบ user ออกจาก assigned_users ถ้าไม่มีงานอื่นใน step นั้น
      for (const stepId of stepIds) {
        // เช็คว่ามีงานอื่นของ user ใน step นี้หรือไม่
        const otherWork = await pool.query(
          `SELECT id FROM daily_work_records 
           WHERE id != $1 AND user_id = $2 
           AND (step_id = $3 OR step_ids @> to_jsonb($3::int) OR step_ids @> to_jsonb(($3::int)::text))`,
          [id, userId, stepId]
        );
        
        // ถ้าไม่มีงานอื่น ให้ลบ user ออกจาก assigned_users
        if (otherWork.rows.length === 0) {
          const stepResult = await pool.query('SELECT assigned_users FROM task_steps WHERE id = $1', [stepId]);
          if (stepResult.rows.length > 0) {
            let assignedUsers = stepResult.rows[0].assigned_users || [];
            assignedUsers = assignedUsers.filter(u => u.id !== userId);
            await pool.query('UPDATE task_steps SET assigned_users = $1::jsonb WHERE id = $2',
              [JSON.stringify(assignedUsers), stepId]);
          }
        }
      }
    }
    
    await pool.query('DELETE FROM daily_work_records WHERE id = $1', [id]);
    if (oldData) await removeFilesIfUnreferenced(oldData.files);

    // Log audit
    if (oldData) {
      await logAudit(req, {
        action: 'DELETE',
        tableName: 'daily_work_records',
        recordId: parseInt(id),
        recordName: `${oldData.task_name || 'งาน'} - ${oldData.work_date}`,
        oldData
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting daily work record:', error);
    res.status(500).json({ error: 'ไม่สามารถลบงานประจำวันได้' });
  }
});

// Manual trigger workflow summary to Teams
router.post('/trigger-workflow-summary', async (req, res) => {
  try {
    const { sendWorkflowSummaryToTeams } = await import('../services/workflowNotificationService.js');
    await sendWorkflowSummaryToTeams();
    res.json({ success: true, message: 'Workflow summary sent to Teams' });
  } catch (error) {
    console.error('Error sending workflow summary:', error);
    res.status(500).json({ error: 'ไม่สามารถส่งสรุปงานได้' });
  }
});

export { sendDailyWorkSummaryToTeams };
export default router;

// Lightweight daily work for dashboard - no subqueries
router.get('/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        dwr.id, dwr.task_id, dwr.user_id,
        TO_CHAR(dwr.work_date, 'YYYY-MM-DD') as work_date,
        dwr.start_time, dwr.end_time, dwr.total_hours,
        dwr.work_status, dwr.location,
        COALESCE(u.firstname || ' ' || u.lastname, 'ไม่ระบุ') as employee_name,
        COALESCE(u.department, 'ไม่ระบุ') as employee_department,
        t.task_name,
        COALESCE(t.category, 'งานทั่วไป') as category,
        (
          SELECT json_agg(json_build_object(
            'id', s.id,
            'step_name', s.step_name,
            'step_order', s.step_order,
            'status', s.status,
            'project_statuses', s.project_statuses
          ) ORDER BY s.step_order)
          FROM task_steps s
          WHERE s.id = ANY(
            CASE 
              WHEN dwr.step_ids IS NOT NULL AND jsonb_array_length(dwr.step_ids) > 0 
              THEN ARRAY(SELECT jsonb_array_elements_text(dwr.step_ids)::int)
              WHEN dwr.step_id IS NOT NULL THEN ARRAY[dwr.step_id]
              ELSE ARRAY[]::int[]
            END
          )
        ) as steps_data
      FROM daily_work_records dwr
      LEFT JOIN users u ON dwr.user_id = u.id
      LEFT JOIN tasks t ON dwr.task_id = t.id
      ORDER BY dwr.work_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching daily work summary:', error);
    res.status(500).json({ error: 'ไม่สามารถโหลดสรุปงานประจำวันได้' });
  }
});

