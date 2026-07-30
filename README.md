# Backend – Sistem Manajemen Absensi Karyawan Berbasis QR Code
### BUMDESMA Podo Rukun LKD

REST API untuk sistem absensi karyawan berbasis QR Code statis dengan validasi
geofencing, dibangun sesuai rancangan pada dokumen Bab III (Analisis dan
Perancangan Sistem).

## Stack Teknologi

| Layer | Teknologi |
|---|---|
| Runtime | Node.js + Express.js |
| Database | PostgreSQL (Sequelize ORM) |
| Autentikasi | JSON Web Token (JWT) + bcrypt |
| Validasi lokasi | Haversine formula (geofencing) |
| QR Code | Library `qrcode` (generate PNG statis) |
| Export laporan | `pdfkit` (PDF) & `exceljs` (Spreadsheet) |
| Upload file | `multer` (lampiran surat izin/cuti) |

## Arsitektur

Mengikuti *API-Driven Architecture* dengan pola *Client-Server* terpisah:
Aplikasi Mobile Karyawan (Flutter) dan Website Admin/Pimpinan (React) sama-sama
mengonsumsi REST API ini melalui HTTP/JSON.

## Struktur Folder

```
bumdesma-backend/
├── server.js                  # Entry point
├── src/
│   ├── app.js                 # Konfigurasi Express
│   ├── config/                 # Koneksi DB & config Sequelize CLI
│   ├── models/                 # 8 model Sequelize + asosiasi (ERD)
│   ├── migrations/              # Skema database (urut sesuai FK)
│   ├── seeders/                 # Data awal (akun, jadwal kerja, setting)
│   ├── controllers/             # Logika bisnis per modul
│   ├── routes/                  # Definisi endpoint per modul
│   ├── middlewares/             # Auth, error handler, upload, validasi
│   └── utils/                   # JWT, geofencing, response, dsb
└── uploads/
    ├── qrcode/                  # Gambar QR Code hasil generate
    └── surat-izin/               # Lampiran surat izin/cuti karyawan
```

## Skema Database (sesuai ERD Bab III)

- **users** — data Admin, Karyawan, Pimpinan (role: admin/karyawan/pimpinan)
- **work_schedules** — jadwal kerja reguler (Senin–Jumat) & piket (Sabtu)
- **qr_codes** — token QR Code statis (hanya satu token aktif pada satu waktu)
- **attendances** — riwayat presensi harian (1 baris per karyawan per tanggal)
- **leaves** — pengajuan izin/cuti (alur: pending → diteruskan Admin → approved/rejected Pimpinan)
- **piket_schedules** — penugasan piket Sabtu per karyawan
- **system_settings** — parameter sistem (koordinat kantor, radius geofencing, hari libur)
- **activity_logs** — audit trail seluruh aktivitas penting

Relasi foreign key mengikuti ERD: `Users 1—N Attendance/Leave/PiketSchedule/ActivityLog`,
`QrCode 1—N Attendance`, `WorkSchedule 1—N Attendance`.

## Instalasi & Menjalankan

### 1. Prasyarat
- Node.js ≥ 18
- PostgreSQL ≥ 13

### 2. Setup
```bash
npm install
cp .env.example .env
# sesuaikan DB_HOST, DB_USER, DB_PASSWORD, JWT_SECRET, dll di .env
```

### 3. Buat database & jalankan migrasi + seeder
```bash
npx sequelize-cli db:create
npm run db:migrate
npm run db:seed
```

### 4. Jalankan server
```bash
npm run dev     # dengan nodemon (development)
npm start        # production
```

Server berjalan di `http://localhost:5000`, base URL API: `http://localhost:5000/api`.

### Akun default (dari seeder)

| Role | NIP | Password |
|---|---|---|
| Admin | `ADM001` | `Admin@12345` |
| Pimpinan | `PIM001` | `Pimpinan@12345` |
| Karyawan (contoh) | `KAR001` | `Karyawan@123` (wajib ganti password saat login pertama) |

## Ringkasan Endpoint API

Seluruh endpoint (kecuali login) memerlukan header `Authorization: Bearer <accessToken>`.

### Auth
| Method | Endpoint | Akses |
|---|---|---|
| POST | `/api/auth/login` | Publik |
| POST | `/api/auth/refresh-token` | Publik |
| POST | `/api/auth/change-password` | Semua role |
| GET | `/api/auth/me` | Semua role |
| POST | `/api/auth/logout` | Semua role |

### Pegawai/Karyawan (`/api/users`) — Admin
| Method | Endpoint |
|---|---|
| GET | `/` (query: role, status, search, page, limit) |
| GET | `/:id` |
| POST | `/` |
| PUT | `/:id` |
| PATCH | `/:id/status` |
| POST | `/:id/reset-password` |
| DELETE | `/:id` (soft delete) |

### Absensi (`/api/attendance`)
| Method | Endpoint | Akses |
|---|---|---|
| POST | `/scan` | Karyawan (mobile) |
| GET | `/me` | Karyawan |
| GET | `/` (filter tanggal/user/status) | Admin, Pimpinan |
| GET | `/dashboard-summary` | Admin, Pimpinan |
| PUT | `/:id` (koreksi manual) | Admin |

### Izin/Cuti (`/api/leaves`)
| Method | Endpoint | Akses |
|---|---|---|
| POST | `/` (multipart, field `file`) | Karyawan |
| GET | `/me` | Karyawan |
| GET | `/` | Admin, Pimpinan |
| PUT | `/:id/review` | Admin (meneruskan ke Pimpinan) |
| PUT | `/:id/decision` | Pimpinan (approved/rejected) |

### Piket (`/api/piket`)
| Method | Endpoint | Akses |
|---|---|---|
| GET | `/` | Admin, Pimpinan |
| GET | `/me` | Karyawan |
| POST | `/` (body: tanggal, userIds[]) | Admin |
| DELETE | `/:id` | Admin |

### Laporan (`/api/reports`) — Admin, Pimpinan
| Method | Endpoint |
|---|---|
| GET | `/summary?start=&end=` |
| GET | `/attendance/export?start=&end=&format=pdf\|xlsx` |

### Pengaturan (`/api/settings`)
| Method | Endpoint | Akses |
|---|---|---|
| GET | `/` | Admin, Pimpinan |
| PUT | `/` | Admin |
| PUT | `/work-schedule/:dayType` | Admin |
| GET | `/qr-code` | Admin, Pimpinan |
| POST | `/qr-code/generate` | Admin |

### Log Aktivitas (`/api/activity-logs`) — Admin
| Method | Endpoint |
|---|---|
| GET | `/` (filter action, user_id, tanggal) |

## Logika Bisnis Utama

**Scan QR (`POST /api/attendance/scan`)** — menjalankan 4 lapis validasi sesuai
Bab III:
1. **Layer 1 – Autentikasi**: token JWT karyawan (middleware `authenticate`).
2. **Layer 2 – Token QR**: memverifikasi token cocok dengan QR Code statis aktif.
3. **Layer 3 – Geofencing**: Haversine formula, ditolak jika jarak > radius (default 50m).
4. **Layer 4 – Jadwal**: Senin–Jumat pakai jadwal reguler; Sabtu hanya jika
   terdaftar di `piket_schedules`; jika tidak ada catatan check-in → **absen masuk**
   (status tepat waktu/terlambat berdasarkan toleransi); jika sudah check-in
   tanpa check-out → **absen pulang** (status normal/lembur); jika sudah
   lengkap → ditolak.

**Alur Izin/Cuti**: `pending` (diajukan karyawan) → `diteruskan` (ditinjau
Admin) → `approved`/`rejected` (keputusan Pimpinan). Saat disetujui, sistem
otomatis mengisi rekap harian berstatus **Izin/Cuti** pada rentang tanggal
terkait sehingga akses scan ditutup untuk tanggal tersebut.

**QR Code statis**: hanya satu token aktif pada satu waktu; generate/regenerasi
otomatis menonaktifkan token sebelumnya dan menghasilkan gambar PNG baru.

## Catatan

- Password disimpan ter-hash dengan bcrypt (10 rounds).
- Soft delete pada tabel `users` (kolom `deleted_at`) agar riwayat presensi
  karyawan yang keluar tetap terjaga.
- `activity_logs` mencatat setiap aksi penting untuk kebutuhan audit trail.
- Endpoint push-notification (piket & keputusan izin) dicatat di log namun
  pengiriman aktual ke perangkat karyawan memerlukan integrasi layanan pihak
  ketiga (di luar cakupan API ini) — cukup ganti implementasi pada
  `piket.controller.js` / `leave.controller.js` sesuai provider yang dipilih.
