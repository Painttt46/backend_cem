// รันฟังก์ชัน (เช่น DDL เตรียม schema) ครั้งเดียวต่อโปรเซส แล้วคืนผลเดิมให้ผู้เรียกครั้งต่อ ๆ ไป
// เดิม DDL ถูกรันซ้ำในทุกคำขอ ทำให้ต้องขอล็อกตารางทุกครั้งที่มีคนเปิดหน้า
// ถ้ารันไม่สำเร็จ (เช่น DB ยังไม่พร้อม) จะเคลียร์ผลไว้ให้คำขอถัดไปลองใหม่
export const runOnce = (fn) => {
  let promise = null;
  return () => {
    if (!promise) promise = fn().catch((error) => { promise = null; throw error; });
    return promise;
  };
};
