# คู่มือการติดตั้งและใช้งานระบบรวบรวมปัญหา

## ข้อกำหนดเบื้องต้น
- PHP >= 8.2
- Composer
- Node.js และ npm
- Database (SQLite, MySQL, PostgreSQL)

## ขั้นตอนการติดตั้ง

### 1. ติดตั้ง Dependencies
```bash
composer install
npm install
```

### 2. ตั้งค่า Environment
```bash
cp .env.example .env
php artisan key:generate
```

แก้ไขไฟล์ `.env` ตามความต้องการ:
- ตั้งค่า `DB_CONNECTION` และข้อมูล database
- ตั้งค่า `APP_URL`

### 3. สร้าง Database และ Migrate
```bash
php artisan migrate
php artisan db:seed
```

### 4. สร้าง Storage Link สำหรับวิดีโอ
```bash
php artisan storage:link
```

### 5. Build Frontend
```bash
npm run build
```

หรือสำหรับ development:
```bash
npm run dev
```

### 6. เริ่ม Server
```bash
php artisan serve
```

## ข้อมูลเข้าสู่ระบบ Admin

หลังจากรัน seeder:
- **Email**: admin@example.com
- **Password**: password

**⚠️ ควรเปลี่ยนรหัสผ่านทันทีหลังจากติดตั้งเสร็จ!**

## โครงสร้างระบบ

### สำหรับ User ทั่วไป:
- หน้าแรก: `/` - หน้า Landing page
- รายการปัญหา: `/problems` - ดูรายการปัญหาทั้งหมด พร้อมค้นหาและกรองตามหมวดหมู่
- รายละเอียดปัญหา: `/problems/{id}` - ดูรายละเอียด วิดีโอ และวิธีแก้ไข

### สำหรับ Admin:
- Login: `/admin/login`
- Dashboard: `/admin/dashboard`
- จัดการปัญหา: `/admin/problems`
- จัดการหมวดหมู่: `/admin/categories`
- จัดการผู้ใช้: `/admin/users`
- จัดการเนื้อหา: `/admin/page-contents`

## ฟีเจอร์หลัก

1. **ระบบ Authentication**
   - Admin login ด้วย email/password
   - User ทั่วไปไม่ต้อง login

2. **จัดการปัญหา**
   - เพิ่ม/แก้ไข/ลบปัญหา
   - อัปโหลดวิดีโอปัญหา
   - เพิ่มวิธีแก้ไข (ข้อความและวิดีโอ)
   - ตั้งค่าสถานะการแสดงผล

3. **จัดการหมวดหมู่**
   - เพิ่ม/แก้ไข/ลบหมวดหมู่
   - เรียงลำดับหมวดหมู่

4. **จัดการผู้ใช้**
   - เพิ่ม/แก้ไข/ลบผู้ใช้
   - กำหนดบทบาท (admin/user)

5. **จัดการเนื้อหา**
   - แก้ไขเนื้อหาหน้าเว็บ (เช่น หน้าแรก)

6. **QR Code**
   - สร้าง QR Code สำหรับแต่ละปัญหา
   - สแกนเพื่อเปิดดูวิดีโอได้ทันที

7. **ระบบค้นหาและกรอง**
   - ค้นหาปัญหาตามคำค้น
   - กรองตามหมวดหมู่

## การอัปโหลดวิดีโอ

- รองรับไฟล์วิดีโอ: mp4, avi, mov, wmv, flv, webm
- ขนาดสูงสุด: 100MB
- วิดีโอจะถูกเก็บไว้ใน `storage/app/public/videos/`

## API Endpoints

### Public API (ไม่ต้อง authentication)
- `GET /api/home` - ข้อมูลหน้าแรก
- `GET /api/problems` - รายการปัญหา
- `GET /api/problems/{id}` - รายละเอียดปัญหา
- `GET /api/categories` - รายการหมวดหมู่
- `GET /api/page-content/{key}` - เนื้อหาหน้าเว็บ

### Admin API (ต้อง authentication)
- `POST /api/login` - เข้าสู่ระบบ
- `POST /api/logout` - ออกจากระบบ
- `GET /api/me` - ข้อมูลผู้ใช้ปัจจุบัน

#### Problems
- `GET /api/admin/problems` - รายการปัญหาทั้งหมด
- `POST /api/admin/problems` - สร้างปัญหาใหม่
- `PUT /api/admin/problems/{id}` - แก้ไขปัญหา
- `DELETE /api/admin/problems/{id}` - ลบปัญหา

#### Categories
- `GET /api/admin/categories` - รายการหมวดหมู่ทั้งหมด
- `POST /api/admin/categories` - สร้างหมวดหมู่ใหม่
- `PUT /api/admin/categories/{id}` - แก้ไขหมวดหมู่
- `DELETE /api/admin/categories/{id}` - ลบหมวดหมู่

#### Users
- `GET /api/admin/users` - รายการผู้ใช้ทั้งหมด
- `POST /api/admin/users` - สร้างผู้ใช้ใหม่
- `PUT /api/admin/users/{id}` - แก้ไขผู้ใช้
- `DELETE /api/admin/users/{id}` - ลบผู้ใช้

#### Page Contents
- `GET /api/admin/page-contents` - รายการเนื้อหาทั้งหมด
- `POST /api/admin/page-contents` - สร้างเนื้อหาใหม่
- `PUT /api/admin/page-contents/{id}` - แก้ไขเนื้อหา
- `DELETE /api/admin/page-contents/{id}` - ลบเนื้อหา

## การพัฒนา

### Development Mode
```bash
# Terminal 1: Laravel Server
php artisan serve

# Terminal 2: Vite Dev Server
npm run dev
```

### Production Build
```bash
npm run build
php artisan optimize
```

## หมายเหตุ

- ระบบใช้ Laravel Sanctum สำหรับ API authentication
- Frontend ใช้ React + React Router
- UI ใช้ Tailwind CSS
- QR Code ใช้ qrcode.react library

## การแก้ไขปัญหา

### วิดีโอไม่แสดง
- ตรวจสอบว่าได้รัน `php artisan storage:link` แล้ว
- ตรวจสอบ permissions ของโฟลเดอร์ `storage/app/public`

### ไม่สามารถ login ได้
- ตรวจสอบว่าได้รัน migration และ seeder แล้ว
- ตรวจสอบข้อมูลใน database

### API ไม่ทำงาน
- ตรวจสอบว่าได้ติดตั้ง Laravel Sanctum แล้ว
- ตรวจสอบ CORS settings (ถ้า frontend และ backend อยู่คนละ domain)

