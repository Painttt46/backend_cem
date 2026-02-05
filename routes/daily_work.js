import express from 'express';
import pool from '../config/database.js';
import fetch from 'node-fetch';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();

// Calendar event creation function using Microsoft Graph API
async function sendCalendarEvent(data) {
  console.log('sendCalendarEvent called with data:', data);

  try {
    const startDateTime = `${data.work_date}T${data.start_time}+07:00`;
    const endDateTime = `${data.work_date}T${data.end_time}+07:00`;

    console.log('DateTime range:', { startDateTime, endDateTime });

    // Get user's email from database
    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [data.user_id]);
    const userEmail = userResult.rows.length > 0 ? userResult.rows[0].email : null;

    console.log('User email from DB:', userEmail);

    if (!userEmail) {
      console.error('User email not found, cannot create calendar event');
      return;
    }

    // Check if Azure credentials are configured
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const tenantId = process.env.AZURE_TENANT_ID;

    console.log('Azure config check:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasTenantId: !!tenantId
    });

    if (!clientId || !clientSecret || !tenantId) {
      console.error('Azure AD credentials not configured');
      return;
    }

    // Get access token with application permissions
    console.log('Getting access token...');
    const accessToken = await getAccessToken();
    console.log('Access token obtained:', !!accessToken);

    if (!accessToken) {
      console.error('Failed to get access token');
      return;
    }

    // Prepare attendees
    const attendees = [];

    if (data.attendees && data.attendees.length > 0) {
      data.attendees.forEach(attendee => {
        const email = typeof attendee === 'string' ? attendee : attendee.email;
        const name = typeof attendee === 'string' ? attendee : (attendee.name || attendee.email);
        if (email) {
          attendees.push({
            emailAddress: { address: email, name: name },
            type: "required"
          });
        }
      });
    }

    const calendarEvent = {
      subject: data.task_name,
      body: {
        contentType: "HTML",
        content: `<p><strong>ผู้ปฏิบัติงาน:</strong> ${data.user_name}</p><p><strong>รายละเอียด:</strong> ${data.work_description || 'ไม่ระบุ'}</p>${data.event_details ? `<p><strong>รายละเอียดเพิ่มเติม:</strong> ${data.event_details}</p>` : ''}`
      },
      start: {
        dateTime: startDateTime,
        timeZone: "Asia/Bangkok"
      },
      end: {
        dateTime: endDateTime,
        timeZone: "Asia/Bangkok"
      },
      location: {
        displayName: data.location || ''
      },
      attendees: attendees,
      isOnlineMeeting: data.create_teams_meeting === true,
      onlineMeetingProvider: data.create_teams_meeting === true ? "teamsForBusiness" : undefined
    };

    console.log('Calendar event payload:', JSON.stringify(calendarEvent, null, 2));

    // Use Microsoft Graph API endpoint for specific user
    const graphApiUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/events`;
    console.log('Graph API URL:', graphApiUrl);

    const response = await fetch(graphApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(calendarEvent)
    });

    console.log('Graph API response status:', response.status);
    const responseText = await response.text();
    console.log('Graph API response:', responseText);

    if (!response.ok) {
      console.error('Graph API calendar event creation failed:', response.status, responseText);
    } else {
      console.log(`Calendar event created successfully for user: ${userEmail}`);
    }
  } catch (error) {
    console.error('Graph API calendar event error:', error);
  }
}

// Function to get access token for Microsoft Graph API
async function getAccessToken() {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_TENANT_ID;

  console.log('Getting access token with tenant:', tenantId);

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('scope', 'https://graph.microsoft.com/.default');
  params.append('grant_type', 'client_credentials');

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });

    console.log('Token response status:', response.status);
    const data = await response.json();
    console.log('Token response:', data);

    if (!response.ok) {
      console.error('Failed to get access token:', data);
      return null;
    }

    return data.access_token;
  } catch (error) {
    console.error('Error getting access token:', error);
    return null;
  }
}

// Teams notification function
async function sendTeamsNotification(type, data) {
  const webhookUrl = 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/cbf939ffce724711ac4af407711304ac/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=ZeDUCEcFZZFUlCRH1P3s5LV7YI_-idjHjNPpMoL2qYA';

  try {
    const message = createDailyWorkMessage(type, data);
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

// Send daily work summary to Teams
async function sendDailyWorkSummaryToTeams() {
  const webhookUrl = 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/772efa7dba4846248602bec0f4ec9adf/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=u_vIlVoRaHZOEJ-gEE6SXcdJ-HZPpp3KN6-y1WSoGRI';
  
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
    
    console.log('Latest record:', { id: latestId, user_id: latestUserId, user_name: latestRecord.user_name, updated_at: latestRecord.updated_at });

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

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      console.error('Daily work summary Teams notification failed:', response.status);
    } else {
      console.log('Daily work summary sent to Teams');
    }
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
  console.log('Auto checking missing work for date:', today);

  // Reset notification flag if it's a new day
  if (lastNotificationDate !== today) {
    lastNotificationDate = today;
    allCompleteNotified = false;
    allCompleteNotifiedDate = null;
  }

  // Get all active users (exclude admin role)
  const activeUsersResult = await pool.query(`
    SELECT id, firstname || ' ' || lastname as name, position, 
           COALESCE(department, 'ไม่ระบุ') as department 
    FROM users 
    WHERE is_active = true AND role != 'admin'
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
  console.log('All active users:', activeUsers.map(u => `${u.name} (ID: ${u.id})`));
  console.log('Submitted user IDs:', submittedUserIds);
  console.log('Approved leave user IDs:', approvedLeaveUserIds);

  // Find missing users
  const missingUsers = activeUsers.filter(user =>
    !submittedUserIds.includes(user.id) && !approvedLeaveUserIds.includes(user.id)
  );

  console.log('Missing users:', missingUsers.map(u => `${u.name} (ID: ${u.id})`));
  console.log('Auto check - Missing users count:', missingUsers.length);

  if (missingUsers.length > 0) {
    console.log('Auto sending missing work notification...');
    await sendTeamsNotification('missing_work', { missingUsers });
  } else if (activeUsers.length > 0 && allCompleteNotifiedDate !== today) {
    console.log('Auto sending all complete notification (once per day)...');
    await sendTeamsNotification('all_complete', { totalUsers: activeUsers.length });
    allCompleteNotified = true;
    allCompleteNotifiedDate = today;
    console.log('All complete notification sent and marked as notified for today');
  } else {
    console.log('All work submitted - no notification needed');
  }
}

//Start auto check when server starts
startAutoCheck();
router.post('/check-missing', async (req, res) => {
  try {
    // Use Thailand timezone
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    console.log('Checking missing work for date:', today);

    // Get all active users (include NULL as active, exclude admin role)
    const activeUsersResult = await pool.query(`
      SELECT id, firstname || ' ' || lastname as name, position, 
             COALESCE(department, 'ไม่ระบุ') as department 
      FROM users 
      WHERE (is_active IS NULL OR is_active = true) AND role != 'admin'
    `);
    console.log('Active users found:', activeUsersResult.rows.length);

    // Get users who have submitted work today
    const submittedUsersResult = await pool.query(`
      SELECT DISTINCT user_id 
      FROM daily_work_records 
      WHERE work_date::date = $1::date
    `, [today]);
    console.log('Users who submitted work today:', submittedUsersResult.rows.length);

    // Get users who have approved leave today
    const approvedLeaveResult = await pool.query(`
      SELECT DISTINCT user_id
      FROM leave_requests 
      WHERE status = 'approved' 
      AND start_datetime::date <= $1 
      AND end_datetime::date >= $1
    `, [today]);
    console.log('Users with approved leave today:', approvedLeaveResult.rows.length);

    const submittedUserIds = submittedUsersResult.rows.map(row => row.user_id);
    const approvedLeaveUserIds = approvedLeaveResult.rows.map(row => row.user_id);
    const activeUsers = activeUsersResult.rows;

    // Find missing users (exclude those with approved leave)
    const missingUsers = activeUsers.filter(user =>
      !submittedUserIds.includes(user.id) && !approvedLeaveUserIds.includes(user.id)
    );

    console.log('Missing users count:', missingUsers.length);
    console.log('Missing users:', missingUsers.map(u => u.name));

    if (missingUsers.length > 0) {
      console.log('Sending missing work notification...');
      await sendTeamsNotification('missing_work', { missingUsers });
      res.json({ message: 'Missing work notification sent', missingCount: missingUsers.length });
    } else if (allCompleteNotifiedDate !== today) {
      console.log('Sending all complete notification...');
      await sendTeamsNotification('all_complete', { totalUsers: activeUsers.length });
      allCompleteNotifiedDate = today;
      res.json({ message: 'All complete notification sent', totalUsers: activeUsers.length });
    } else {
      res.json({ message: 'All complete notification already sent today', totalUsers: activeUsers.length });
    }
  } catch (error) {
    console.error('Error checking missing work:', error);
    res.status(500).json({ error: error.message });
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
            'has_work_logged', EXISTS(SELECT 1 FROM daily_work_records d WHERE (d.step_id = s.id OR (d.step_ids IS NOT NULL AND d.step_ids ? s.id::text)) AND d.work_date <= CURRENT_DATE),
            'latest_work_date', (SELECT MAX(work_date) FROM daily_work_records d WHERE (d.step_id = s.id OR (d.step_ids IS NOT NULL AND d.step_ids ? s.id::text)) AND d.work_date <= CURRENT_DATE)
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
    res.status(500).json({ error: error.message });
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

  // รองรับทั้ง step_id (single) และ step_ids (array)
  const finalStepIds = step_ids || (step_id ? [step_id] : [null]);

  // ดึง work_status จาก task.status
  let work_status = null;

  console.log('Daily work POST request:', { task_id, step_ids: finalStepIds, work_date, work_status, user_id });

  try {
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
      work_status, location, work_description, JSON.stringify(files || []), user_id, submitted_at
    ]);

    // Auto-add user to assigned_users if not already assigned
    if (user_id && finalStepIds.length > 0) {
      const userResult = await pool.query('SELECT id, firstname, lastname FROM users WHERE id = $1', [user_id]);
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

    // Create calendar event if requested
    if (create_calendar_event && event_title && (meeting_start_time || start_time) && (meeting_end_time || end_time)) {
      const eventStartTime = meeting_start_time || start_time;
      const eventEndTime = meeting_end_time || end_time;
      
      console.log('Creating calendar event with data:', {
        event_title,
        work_date,
        start_time: eventStartTime,
        end_time: eventEndTime,
        location,
        work_description,
        user_id,
        attendees,
        meeting_room
      });

      try {
        // Get user info
        const userResult = await pool.query('SELECT firstname, lastname FROM users WHERE id = $1', [user_id]);
        const userName = userResult.rows.length > 0 ?
          `${userResult.rows[0].firstname} ${userResult.rows[0].lastname}` : 'ไม่ระบุ';

        await sendCalendarEvent({
          task_name: event_title,
          work_date,
          start_time: eventStartTime,
          end_time: eventEndTime,
          location,
          work_description,
          user_name: userName,
          user_id,
          attendees: attendees || [],
          create_teams_meeting,
          event_details
        });
      } catch (calendarError) {
        console.error('Calendar event creation failed:', calendarError);
        // Don't fail the main request if calendar creation fails
      }
    } else {
      console.log('Calendar event not created. Conditions:', {
        create_calendar_event,
        has_task_name: !!task_name,
        has_start_time: !!start_time,
        has_end_time: !!end_time
      });
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

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update daily work record
router.put('/:id', async (req, res) => {
  console.log('PUT /api/daily-work/:id called, id:', req.params.id);
  try {
    const { id } = req.params;
    const { task_id, step_id, work_date, start_time, end_time, work_status, location, work_description, files } = req.body;

    // คำนวณ total_hours จาก start_time และ end_time
    let total_hours = 0;
    if (start_time && end_time) {
      const start = new Date(`1970-01-01T${start_time}`);
      const end = new Date(`1970-01-01T${end_time}`);
      total_hours = (end - start) / (1000 * 60 * 60);
    }

    const result = await pool.query(`
      UPDATE daily_work_records 
      SET task_id = $1, step_id = $2, work_date = $3, start_time = $4, end_time = $5, total_hours = $6,
          work_status = $7, location = $8, work_description = $9, 
          files = $10::jsonb, updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `, [task_id, step_id, work_date, start_time, end_time, total_hours, work_status, location, work_description, JSON.stringify(files || []), id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Daily work record not found' });
    }

    // Send Teams notification only if work_date is today
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    if (work_date === today) {
      console.log('Sending Teams notification after edit...');
      try {
        await sendDailyWorkSummaryToTeams();
        console.log('Teams notification sent successfully');
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
           AND (step_id = $3 OR step_ids @> to_jsonb($3::int))`,
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
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger workflow summary to Teams
router.post('/trigger-workflow-summary', async (req, res) => {
  try {
    const { sendWorkflowSummaryToTeams } = await import('../services/workflowNotificationService.js');
    await sendWorkflowSummaryToTeams();
    res.json({ success: true, message: 'Workflow summary sent to Teams' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export { sendDailyWorkSummaryToTeams };
export default router;
