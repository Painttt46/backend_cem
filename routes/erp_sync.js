/**
 * erp_sync.js
 * -----------
 * Route สำหรับ sync ข้อมูลโครงการ (Project) จากระบบ ERPNext (172.30.101.203)
 * มาสร้าง/อัปเดต tasks ใน database ของ backend_cem
 *
 * Endpoints:
 *   POST /api/erp-sync/projects  — ดึง project ทั้งหมดจาก ERP แล้ว upsert เข้า tasks table
 *   GET  /api/erp-sync/status    — ดูจำนวน tasks ที่ sync มาจาก ERP แล้ว
 *
 * การทำงาน (POST /api/erp-sync/projects):
 *   1. ดึง list ของ project ทั้งหมดจาก GET /api/resource/Project?limit_page_length=All
 *      → ได้ array ของ { name: "SO20004" } (name = SO number)
 *   2. Loop แต่ละ project → ดึง detail จาก GET /api/resource/Project/{name}
 *      → ได้ข้อมูลเต็ม เช่น project_name, sales_person, customer, status, department
 *   3. Upsert เข้า tasks table โดยใช้ so_number เป็น unique key
 *      - ถ้ายังไม่มี → INSERT (สร้างใหม่)
 *      - ถ้ามีแล้ว   → UPDATE เฉพาะ fields ที่เกี่ยวข้อง
 *   4. คืนผลลัพธ์ { total, created, updated, failed }
 *
 * Field mapping (ERPNext → tasks table):
 *   name               → so_number         (SO number เช่น SO20004, DEV2301)
 *   project_name       → task_name         (ชื่อโครงการ)
 *   sales_person       → sale_owner        (ชื่อ sales ที่รับผิดชอบ)
 *   customer           → customer_info     (ชื่อลูกค้า)
 *   status             → status            (Open/Completed/Cancelled → map เป็น lowercase)
 *   expected_start_date→ project_start_date(วันเริ่มโครงการ ถ้าไม่มีใส่ null)
 *   expected_end_date  → project_end_date  (วันสิ้นสุดโครงการ ถ้าไม่มีใส่ null)
 *   department         → category          (แผนก เช่น Sale and Marketing)
 *
 * Auth:
 *   - ERP ใช้ token fixed: "token 0f9489d25f720f5:cab51bb0963303d"
 *   - Endpoint นี้ต้องผ่าน verifyToken (JWT) ก่อนถึงจะเรียกได้ (register ใน server.js)
 *   - ใช้ https agent แบบ rejectUnauthorized: false เพราะ ERP server ใช้ self-signed cert
 */

import express from 'express'
import fetch from 'node-fetch'
import https from 'https'
import pool from '../config/database.js'

const router = express.Router()

// Base URL ของ ERPNext API
const ERP_BASE = 'https://172.30.101.203/api/resource'

// Token สำหรับ authenticate กับ ERPNext (format: "token api_key:api_secret")
const ERP_TOKEN = 'token 0f9489d25f720f5:cab51bb0963303d'

// HTTPS agent ที่ข้าม SSL verification เพราะ ERP ใช้ self-signed certificate
const agent = new https.Agent({ rejectUnauthorized: false })

/**
 * ฟังก์ชัน helper สำหรับ GET request ไปยัง ERPNext
 * @param {string} path - path ต่อจาก ERP_BASE เช่น "/Project?limit_page_length=All"
 * @returns {Promise<object>} - JSON response จาก ERP
 */
const erpGet = (path) =>
  fetch(`${ERP_BASE}${path}`, {
    headers: {
      Authorization: ERP_TOKEN,
      'Content-Type': 'application/json'
    },
    agent
  }).then(r => r.json())

/**
 * POST /api/erp-sync/projects
 *
 * Sync โครงการทั้งหมดจาก ERPNext เข้า tasks table
 * - ดึง list project ทั้งหมด
 * - loop ดึง detail ทีละโครงการ
 * - upsert เข้า DB (INSERT หรือ UPDATE ถ้ามีอยู่แล้ว)
 *
 * Response: { success, total, created, updated, failed }
 */
router.post('/projects', async (req, res) => {
  try {
    // ดึงข้อมูลทั้งหมดในครั้งเดียว (ไม่ต้องดึง detail ทีละตัว)
    const fields = encodeURIComponent(JSON.stringify(['name','project_name','status','sales_person','customer','expected_start_date','expected_end_date']))
    const listRes = await erpGet(`/Project?limit_page_length=All&fields=${fields}`)
    const projects = (listRes.data || []).filter(p => p.status === 'Open' || p.status === 'Completed')

    let created = 0, updated = 0, failed = 0
    const createdList = [], updatedList = []

    // Step 2: Upsert ทั้งหมดเข้า DB
    await Promise.all(projects.map(async (p) => {
      try {
        const syncedStatus = p.status === 'Completed' ? 'completed' : null
        const oldRow = await pool.query('SELECT task_name, sale_owner, customer_info, status FROM tasks WHERE so_number=$1', [p.name])
        const oldData = oldRow.rows[0] || null
        const result = await pool.query(`
          INSERT INTO tasks (so_number, task_name, sale_owner, customer_info, status, project_start_date, project_end_date, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,1)
          ON CONFLICT (so_number) DO UPDATE SET
            task_name          = EXCLUDED.task_name,
            sale_owner         = EXCLUDED.sale_owner,
            customer_info      = EXCLUDED.customer_info,
            status             = EXCLUDED.status,
            project_start_date = EXCLUDED.project_start_date,
            project_end_date   = EXCLUDED.project_end_date,
            updated_at         = NOW()
          WHERE (
            tasks.task_name IS DISTINCT FROM EXCLUDED.task_name OR
            tasks.sale_owner IS DISTINCT FROM EXCLUDED.sale_owner OR
            tasks.customer_info IS DISTINCT FROM EXCLUDED.customer_info OR
            tasks.status IS DISTINCT FROM EXCLUDED.status OR
            tasks.project_start_date IS DISTINCT FROM EXCLUDED.project_start_date OR
            tasks.project_end_date IS DISTINCT FROM EXCLUDED.project_end_date
          )
          RETURNING (xmax = 0) AS is_insert
        `, [p.name, p.project_name || p.name, p.sales_person || null, p.customer || null,
            syncedStatus, p.expected_start_date || null, p.expected_end_date || null])
        if (!result.rows[0]) { /* ข้อมูลเหมือนเดิม */ }
        else if (result.rows[0].is_insert) {
          created++
          createdList.push({ name: p.project_name || p.name, so: p.name })
        } else {
          const old = oldData || {}
          const newName = p.project_name || p.name
          const changes = {}
          if (old.task_name !== newName) changes.task_name = { old: old.task_name, new: newName }
          if (old.sale_owner !== (p.sales_person || null)) changes.sale_owner = { old: old.sale_owner, new: p.sales_person || null }
          if (old.customer_info !== (p.customer || null)) changes.customer_info = { old: old.customer_info, new: p.customer || null }
          if (old.status !== syncedStatus) changes.status = { old: old.status, new: syncedStatus }
          updated++
          updatedList.push({ name: newName, so: p.name, changes: Object.keys(changes).length ? changes : null })
        }
      } catch (e) {
        console.error(`[ERP_SYNC] failed: ${p.name}`, e.message)
        failed++
      }
    }))

    // Step 4: คืนผลลัพธ์สรุป
    await pool.query(
      'INSERT INTO erp_sync_logs (total, created, updated, failed, created_list, updated_list) VALUES ($1,$2,$3,$4,$5,$6)',
      [projects.length, created, updated, failed, JSON.stringify(createdList), JSON.stringify(updatedList)]
    )
    // เก็บแค่ 50 รายการล่าสุด ลบอันเก่าออก
    await pool.query('DELETE FROM erp_sync_logs WHERE id NOT IN (SELECT id FROM erp_sync_logs ORDER BY synced_at DESC LIMIT 50)')
    res.json({ success: true, total: projects.length, created, updated, failed, createdList, updatedList })

  } catch (err) {
    console.error('[ERP_SYNC] error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * GET /api/erp-sync/history — ดึงประวัติ sync 5 ครั้งล่าสุดจาก DB
 */
router.get('/history', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM erp_sync_logs ORDER BY synced_at DESC LIMIT 50'
  )
  res.json(result.rows)
})

/**
 * GET /api/erp-sync/status
 *
 * ดูจำนวน tasks ที่ sync มาจาก ERP แล้ว
 * นับจาก so_number ที่ขึ้นต้นด้วย "SO" หรือ "DEV" (pattern ของ ERPNext)
 *
 * Response: { synced_tasks: number }
 */
router.get('/status', async (req, res) => {
  const result = await pool.query(
    `SELECT COUNT(*) FROM tasks WHERE so_number LIKE 'SO%' OR so_number LIKE 'DEV%'`
  )
  res.json({ synced_tasks: parseInt(result.rows[0].count) })
})

export default router
