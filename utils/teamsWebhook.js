// ส่งการ์ดไป Teams webhook (Power Automate) — มี timeout และลองใหม่เมื่อเชื่อมต่อไม่ได้/Teams ตอบ 5xx
// เดิมแต่ละไฟล์ fetch เองโดยไม่มี timeout: เน็ตขาออกสะดุดแล้วรอจน OS ตัดการเชื่อมต่อ (ETIMEDOUT)
// และพิมพ์ stack trace ยาวลง log — ตอนนี้ลองใหม่ให้อัตโนมัติ และ log สั้นบรรทัดเดียวเมื่อพลาดจริง
const DEFAULT_TIMEOUT_MS = 15000;
const retryDelayMs = () => {
  const v = Number(process.env.TEAMS_RETRY_DELAY_MS);
  return Number.isFinite(v) && v >= 0 ? v : 5000;
};

export async function postToTeams(webhookUrl, card, { label = 'Teams', timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok) return true;
      // 4xx = ปัญหาที่ตัวคำขอ/ลิงก์ ลองใหม่ก็ไม่หาย
      if (response.status < 500 || attempt === retries) {
        console.error(`[${label}] ส่ง Teams ไม่สำเร็จ: HTTP ${response.status}`);
        return false;
      }
    } catch (error) {
      if (attempt === retries) {
        const code = error.cause?.code || error.cause?.errors?.[0]?.code || error.code || error.name;
        console.error(`[${label}] ส่ง Teams ไม่สำเร็จ (${code}) หลังลอง ${retries + 1} ครั้ง: ${error.message}`);
        return false;
      }
    }
    await new Promise(resolve => setTimeout(resolve, retryDelayMs() * (attempt + 1)));
  }
  return false;
}
