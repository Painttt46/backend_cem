import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import pool from '../config/database.js';
import { logAudit } from '../utils/auditHelper.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ===== เดือนไทยสำหรับแปลงวันที่ เช่น "26 ส.ค. 69", "15 กรกฎาคม 2569" =====
const THAI_MONTHS = {
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6,
  'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
  'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6,
  'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12
};

// ===== ชื่อ column ที่รองรับแต่ละ field (ไฟล์จริงอาจคลาดเคลื่อนจาก template จึงจับแบบ fuzzy) =====
// เทียบหลัง normalize (ตัดช่องว่าง + lowercase): exact ก่อน แล้วเช็คแบบ includes
const COLUMN_ALIASES = {
  no:           ['ลำดับ', 'ลำดับที่', 'no', '#', 'item no'],
  desc:         ['รายละเอียดครุภัณฑ์', 'รายละเอียด', 'ครุภัณฑ์', 'รายการ', 'รายการสินค้า', 'ชื่อสินค้า', 'description', 'item'],
  brand:        ['ยี่ห้อ', 'แบรนด์', 'ผู้ผลิต', 'brand'],
  model:        ['รุ่นอุปกรณ์', 'รุ่น', 'model'],
  unitPrice:    ['ราคาต่อหน่วย', 'ราคา/หน่วย', 'ราคาต่อชิ้น', 'unit price'],
  total:        ['ราคารวม', 'ราคาซื้อรวม', 'ราคารวมสุทธิ', 'จำนวนเงิน', 'total'],
  qty:          ['จำนวน', 'จำนวนซื้อ', 'qty', 'quantity'],
  unit:         ['หน่วยนับ', 'หน่วย', 'unit', 'units'],
  distributor:  ['distributor', 'vendor', 'supplier', 'ผู้ขาย', 'ร้านค้า', 'ซัพพลายเออร์', 'บริษัท'],
  po:           ['po', 'po number', 'po no', 'เลข po', 'เลขที่ po'],
  status:       ['สถานะ', 'status'],
  orderDate:    ['po date', 'วันที่สั่ง', 'วันที่สั่งซื้อ', 'วันสั่งซื้อ', 'วันที่ po', 'order date'],
  deliveryDate: ['date of deliver', 'กำหนดส่ง', 'กำหนดส่งของ', 'วันที่ส่ง', 'วันส่งของ', 'วันที่ส่งของ', 'delivery date'],
  leadtime:     ['lead time', 'leadtime', 'ระยะเวลาส่ง', 'ระยะส่งของ'],
  notes:        ['หมายเหตุ', 'remark', 'remarks', 'note', 'notes', 'comment']
};

// Helper: จับ field จากชื่อ column (exact ก่อน fuzzy — alias สั้นกว่า 3 ตัวอักษรใช้ exact เท่านั้นกัน false match)
function classifyHeaderCell(raw) {
  const key = String(raw ?? '').replace(/\s+/g, '').toLowerCase();
  if (!key) return null;
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.some(a => a.replace(/\s+/g, '').toLowerCase() === key)) return field;
  }
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const a of aliases) {
      const ns = a.replace(/\s+/g, '').toLowerCase();
      if (ns.length >= 3 && key.includes(ns)) return field;
    }
  }
  return null;
}

// ===== แปลงค่าคอลัมน์สถานะ (ไทย/อังกฤษ) เป็น code =====
const STATUS_MAP = {
  'รอใบเสนอราคา': 'pending', 'pending': 'pending',
  'อนุมัติแล้ว': 'approved', 'approved': 'approved',
  'สั่งซื้อแล้ว': 'ordered', 'ordered': 'ordered', 'สั่งซื้อ': 'ordered', 'เปิดpo': 'ordered',
  'รอของ': 'waiting', 'waiting': 'waiting',
  'ของมาแล้ว': 'received', 'received': 'received', 'ได้รับของแล้ว': 'received',
  'เสร็จสิ้น': 'completed', 'completed': 'completed', 'เสร็จงาน': 'completed'
};

function statusFromCell(v) {
  if (v === null || v === undefined || String(v).trim() === '') return 'pending';
  const k = String(v).replace(/\s+/g, '').toLowerCase();
  if (STATUS_MAP[k]) return STATUS_MAP[k];
  for (const [label, code] of Object.entries(STATUS_MAP)) {
    if (label.length >= 3 && k.includes(label)) return code;
  }
  return 'pending';
}

// Helper: ชื่อ sheet ที่เป็นสรุป/สูตร — ข้าม (จับแบบ fuzzy เพราะไฟล์จริงชื่ออาจต่างไป)
function isSummarySheet(name) {
  return /cost\s*sheet|สูตร|สรุป|summary|รวม|total/i.test(String(name).trim());
}

// Helper: แปลงค่าเซลล์/ข้อความวันที่เป็น 'YYYY-MM-DD'
// รองรับ: dd/mm/yy พ.ศ. (69 = 2569), dd/mm/yyyy ทั้ง พ.ศ./ค.ศ., และ Excel date serial number
function toISODate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // ไม่ใช่ Excel date serial
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  // รูปแบบ ISO อยู่แล้ว (YYYY-MM-DD)
  const iso = String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const iy = parseInt(iso[1], 10), im = parseInt(iso[2], 10), id = parseInt(iso[3], 10);
    if (im >= 1 && im <= 12 && id >= 1 && id <= 31 && iy >= 1900) {
      return iy + '-' + String(im).padStart(2, '0') + '-' + String(id).padStart(2, '0');
    }
    return null;
  }
  const m = String(v).trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) {
    // วันที่แบบเดือนไทย เช่น "26 ส.ค. 69", "15 กรกฎาคม 2569" (ไม่ระบุปี = ปีปัจจุบัน)
    const tm = String(v).trim().match(/^(\d{1,2})\s*([\u0E00-\u0E7F.]{2,})\s*(\d{2,4})?/);
    if (tm && THAI_MONTHS[tm[2]]) {
      const tdd = parseInt(tm[1], 10), tmm = THAI_MONTHS[tm[2]];
      let ty = tm[3] ? parseInt(tm[3], 10) : new Date().getFullYear() + 543;
      if (ty < 100) ty += 2500;
      if (ty > 2400) ty -= 543;
      if (tdd >= 1 && tdd <= 31) return ty + '-' + String(tmm).padStart(2, '0') + '-' + String(tdd).padStart(2, '0');
    }
    return null;
  }
  const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2500;  // 69 → 2569 (พ.ศ.)
  if (y > 2400) y -= 543;  // พ.ศ. → ค.ศ.
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || y < 1900) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// Helper: parse BOQ format — อ่านข้อมูลจาก column โดยตรง (เน้น column ไม่เดาจากข้อความ)
function parseBOQ(workbook) {
  const vendors = [];
  const warnings = [];

  for (const sheetName of workbook.SheetNames) {
    if (isSummarySheet(sheetName)) continue;
    try {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      // หา header row: แถวแรกที่ map ชื่อ column ได้อย่างน้อย 2 fields และมี desc หรือ distributor
      let headerIdx = -1;
      let colMap = {};
      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const r = rows[i];
        if (!r) continue;
        const m = {};
        r.forEach((col, idx) => {
          const f = classifyHeaderCell(col);
          if (f && m[f] === undefined) m[f] = idx;
        });
        if ((m.desc !== undefined || m.distributor !== undefined) && Object.keys(m).length >= 2) {
          headerIdx = i;
          colMap = m;
          break;
        }
      }
      if (headerIdx === -1) {
        warnings.push('Sheet "' + sheetName + '": ไม่พบแถว header (ลำดับ/รายละเอียด/Distributor) — ข้าม');
        continue;
      }

      let noVendorCount = 0;
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;

        const get = (f) => (colMap[f] !== undefined ? r[colMap[f]] : null);
        const desc = get('desc');
        const distributor = get('distributor');
        const brand = get('brand');
        const model = get('model');

        // แถวต้องมีเนื้อหาอย่างน้อยหนึ่งช่อง (แถว template เปล่าที่มีแต่เลขลำดับ = ข้าม)
        const hasContent = [desc, distributor, brand, model].some(x => x !== null && x !== undefined && String(x).trim() !== '');
        if (!hasContent) continue;

        // ข้ามแถวรวม — เฉพาะแถวที่ไม่มีรายละเอียด/vendor (กันเคสข้อความอย่าง "ราคารวม VAT" โดนข้ามโดยไม่ตั้งใจ)
        const hasTotalWord = r.some(c => typeof c === 'string' && c.includes('รวม'));
        if (hasTotalWord && String(desc ?? '').trim() === '' && String(distributor ?? '').trim() === '') continue;

        // รายละเอียด: desc + [ยี่ห้อ] + รุ่น + xจำนวน (normalize whitespace จาก Excel)
        let itemDesc = desc ? String(desc).replace(/\s+/g, ' ').trim() : '';
        if (brand && String(brand).trim()) itemDesc += ' [' + String(brand).replace(/\s+/g, ' ').trim() + ']';
        if (model && String(model).trim()) itemDesc += ' ' + String(model).replace(/\s+/g, ' ').trim();
        const qtyCell = get('qty');
        const qtyVal = typeof qtyCell === 'number' ? qtyCell : null;
        if (qtyVal && qtyVal > 1) itemDesc += ' x' + qtyVal;
        itemDesc = itemDesc.replace(/\s+/g, ' ').trim();

        // ยอดเงิน: คอลัมน์ราคารวมก่อน → ถ้าไม่มี/เป็น 0 ใช้ ราคาต่อหน่วย x จำนวน
        let amountVal = null;
        const totalCell = get('total');
        if (typeof totalCell === 'number' && totalCell > 0) amountVal = Math.round(totalCell * 100) / 100;
        if (amountVal === null) {
          const up = get('unitPrice');
          if (typeof up === 'number' && up > 0) {
            amountVal = Math.round(up * (qtyVal || 1) * 100) / 100;
          }
        }

        // วันที่จากคอลัมน์ (อ่านไม่ออก = แจ้งเตือนให้กรอกเองใน preview)
        const dateCell = (f, label) => {
          const cell = get(f);
          if (cell === null || cell === undefined || String(cell).trim() === '') return null;
          const iso = toISODate(cell);
          if (!iso) warnings.push('Sheet "' + sheetName + '" แถว ' + (i + 1) + ': อ่าน' + label + ' "' + String(cell).trim() + '" ไม่ออก — กรอกเองใน preview');
          return iso;
        };

        const vendorName = distributor ? String(distributor).replace(/\s+/g, ' ').trim() : '';
        if (!vendorName) noVendorCount++;

        const poCell = get('po');
        const notesCell = get('notes');
        const leadtimeCell = get('leadtime');
        const clean = (x) => (x !== null && x !== undefined && String(x).trim() !== '') ? String(x).replace(/\s+/g, ' ').trim() : null;

        vendors.push({
          vendor_name: vendorName,
          item_description: itemDesc || null,
          po_number: clean(poCell),
          order_date: dateCell('orderDate', 'วันที่สั่ง'),
          delivery_date: dateCell('deliveryDate', 'กำหนดส่ง'),
          amount: amountVal,
          leadtime: clean(leadtimeCell),
          notes: clean(notesCell),
          status: statusFromCell(get('status')),
          _sheet: sheetName
        });
      }
      if (noVendorCount > 0) {
        warnings.push('Sheet "' + sheetName + '": ' + noVendorCount + ' รายการไม่มีชื่อ vendor — กรอกชื่อใน preview ก่อนกด Import');
      }
    } catch (e) {
      warnings.push('Sheet "' + sheetName + '": อ่านไม่สำเร็จ (' + e.message + ') — ข้าม');
    }
  }

  if (vendors.length === 0) {
    warnings.push('ไม่พบรายการที่มีข้อมูลในไฟล์ — ต้องมีอย่างน้อย รายละเอียด หรือ Distributor/Vendor ในแถวข้อมูล');
  }
  return { format: 'BOQ', vendors, warnings: warnings.slice(0, 15) };
}


// POST /api/procurement/import/preview — parse ไฟล์ BOQ (column-based) ส่ง preview + warnings กลับ ยังไม่บันทึก
router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const result = parseBOQ(workbook);
    
    res.json({
      format: result.format,
      vendors: result.vendors,
      count: result.vendors.length,
      warnings: result.warnings
    });
  } catch (error) {
    console.error('Import preview error:', error);
    res.status(500).json({ error: 'Failed to parse file: ' + error.message });
  }
});

// POST /api/procurement/import/confirm — บันทึก vendors จริง
router.post('/confirm', async (req, res) => {
  try {
    const { step_id, task_id, vendors } = req.body;
    
    if (!step_id || !task_id || !vendors || !vendors.length) {
      return res.status(400).json({ error: 'step_id, task_id, and vendors are required' });
    }
    
    if (!Number.isInteger(Number(step_id)) || !Number.isInteger(Number(task_id))) {
      return res.status(400).json({ error: 'step_id and task_id must be integers' });
    }
    if (vendors.length > 500) {
      return res.status(400).json({ error: 'Too many vendors (max 500)' });
    }

    const created_by = req.user?.id || null;
    const client = await pool.connect();
    const results = [];

    // Sanitize ค่าที่จะเข้า DB
    const dateOrNull = (x) => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) ? x : null;
    const amountOrNull = (x) => {
      if (x === null || x === undefined || x === '') return null;
      const n = Number(x);
      return isNaN(n) ? null : Math.round(n * 100) / 100;
    };

    try {
      await client.query('BEGIN');

      for (const v of vendors) {
        if (!v.vendor_name || !String(v.vendor_name).trim()) continue;
        const r = await client.query(`
          INSERT INTO procurement_items 
            (step_id, task_id, vendor_name, item_description, amount, po_number, order_date, delivery_date, notes, status, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING *
        `, [step_id, task_id, String(v.vendor_name).trim(), v.item_description || null, amountOrNull(v.amount), v.po_number || null, dateOrNull(v.order_date), dateOrNull(v.delivery_date), v.notes || null, v.status || 'pending', created_by]);
        results.push(r.rows[0]);
      }

      // Update step status to in_progress
      if (results.length > 0) {
        await client.query(`
          UPDATE task_steps SET status = 'in_progress', updated_at = NOW()
          WHERE id = $1 AND (status IS NULL OR status = '' OR status = 'pending')
        `, [step_id]);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    
    await logAudit(req, {
      action: 'IMPORT',
      tableName: 'procurement_items',
      recordId: step_id,
      recordName: `Import ${results.length} vendors`,
      newData: { count: results.length, step_id, task_id }
    });
    
    res.json({ success: true, created: results.length, items: results });
  } catch (error) {
    console.error('Import confirm error:', error);
    res.status(500).json({ error: 'Failed to import: ' + error.message });
  }
});

export default router;
