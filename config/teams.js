// URL ของ Teams webhook (Power Automate) — รวมไว้ที่เดียว เดิมคัดลอกฝังอยู่ใน 5 ไฟล์ (6 จุด)
// ตั้งค่าผ่าน environment variable ได้: TEAMS_WEBHOOK_CAR / TEAMS_WEBHOOK_DAILY_WORK / TEAMS_WEBHOOK_WORK_SUMMARY / TEAMS_WEBHOOK_LEAVE
// ค่าในไฟล์นี้เป็นค่าสำรองเพื่อให้ระบบทำงานเหมือนเดิมระหว่างย้ายไปใช้ env — ลิงก์เหล่านี้มี sig ลับอยู่ในซอร์สโค้ดแล้ว
// ควรสร้าง webhook ใหม่ ตั้งค่าผ่าน env แล้วลบค่าสำรองด้านล่างออก
// (ใช้ getter เพื่ออ่าน process.env ตอนเรียกใช้จริง — dotenv.config() ใน server.js ทำงานหลังการ import)
const FALLBACK = {
  car: 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/4bffff1623c14e5ba6d5247b4aa8f145/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=TbXoIRcOZXL2QHHESf0jIDJ-JMr4jvh-XRovQya1_hM',
  dailyWork: 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/cbf939ffce724711ac4af407711304ac/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=ZeDUCEcFZZFUlCRH1P3s5LV7YI_-idjHjNPpMoL2qYA',
  workSummary: 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/772efa7dba4846248602bec0f4ec9adf/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=u_vIlVoRaHZOEJ-gEE6SXcdJ-HZPpp3KN6-y1WSoGRI',
  leave: 'https://defaultc5fc1b2a2ce84471ab9dbe65d8fe09.06.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/5a51a63928354152a300aa86dd237a77/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=RTyDkT4FoSgIlqjbLVUx7hkJgUl4DODurrfM1f5howw',
};

export const TEAMS_WEBHOOKS = {
  get car() { return process.env.TEAMS_WEBHOOK_CAR || FALLBACK.car; },
  get dailyWork() { return process.env.TEAMS_WEBHOOK_DAILY_WORK || FALLBACK.dailyWork; },
  get workSummary() { return process.env.TEAMS_WEBHOOK_WORK_SUMMARY || FALLBACK.workSummary; },
  get leave() { return process.env.TEAMS_WEBHOOK_LEAVE || FALLBACK.leave; },
};
