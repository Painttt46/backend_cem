FROM node:18-alpine

# ติดตั้ง tzdata เพื่อให้ TZ=Asia/Bangkok (จาก docker-compose.yml) ทำงานได้จริง
# Alpine ไม่มี timezone data ติดมาโดย default ทำให้ TZ env ไม่มีผล (date จะเป็น UTC เสมอ)
# ส่งผลให้ node-cron ที่ตั้ง { timezone: 'Asia/Bangkok' } รันผิดเวลา
RUN apk add --no-cache tzdata

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

RUN mkdir -p uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
