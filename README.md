# Backend – Sistem Manajemen Absensi Karyawan Berbasis QR Code
### BUMDESMA Podo Rukun LKD

REST API untuk sistem absensi karyawan berbasis QR Code statis dengan validasi
geofencing. Melayani dua klien: **Website Admin/Pimpinan** (React) dan
**Aplikasi Mobile Karyawan** (Flutter), masing-masing lewat HTTP/JSON.

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

## Dua Jenis Akun, Dua Tabel Terpisah

Sistem ini **tidak** memakai satu tabel `users` dengan kolom `role` untuk
ketiga aktor. Sebagai gantinya:

- **`users`** — Karyawan saja. Login pakai **NIP + password** dari app
  mobile. Password awal adalah password sementara yang diinput Admin;
  karyawan **wajib ganti password** saat pertama kali login, dan bisa
  sekalian mengisi email (opsional) untuk verifikasi jika suatu saat lupa
  password.
- **`admin_accounts`** — Admin & Pimpinan. Login pakai **username +
  password** dari Website. Dibedakan lewat kolom `role` (`admin` /
  `pimpinan`).

Konsekuensinya, kolom-kolom yang mencatat *siapa melakukan suatu aksi admin*
(`piket_schedules.assigned_by`, `leaves.reviewed_by`/`decided_by`,
`notifications.sent_by`, `attendances.corrected_by`) menunjuk ke
`admin_accounts.id`, bukan `users.id`.

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
│   ├── models/                 # Model Sequelize + asosiasi (ERD)
│   ├── migrations/              # Skema database (urut sesuai FK)
│   ├── seeders/                 # Data awal (akun, jadwal kerja, setting)
│   ├── controllers/             # Logika bisnis per modul
│   ├── routes/                  # Definisi endpoint per modul
│   ├── middlewares/             # Auth, error handler, upload, validasi
│   └── utils/                   # JWT, geofencing, notifier, response, dsb
└── uploads/
    ├── qrcode/                  # Gambar QR Code hasil generate
    └── surat-izin/               # Lampiran surat izin/cuti karyawan
```

## Skema Database

- **users** — data Karyawan (NIP, nama, password, jabatan, phone, email,
  status, `is_first_login`)
- **admin_accounts** — data Admin & Pimpinan (username, nama, password,
  role, status)
- **work_schedules** — jadwal kerja reguler (Senin–Jumat) & piket (Sabtu)
- **qr_codes** — token QR Code statis (hanya satu token aktif pada satu waktu)
- **attendances** — riwayat presensi harian (1 baris per karyawan per tanggal)
- **leaves** — pengajuan izin/cuti (alur: pending → diteruskan Admin → approved/rejected Pimpinan)
- **piket_schedules** — penugasan piket Sabtu per karyawan, `notification_sent`
  jadi `true` hanya setelah Admin menekan tombol "Kirim Notifikasi"
- **notifications** — notifikasi in-app untuk karyawan (jadwal piket,
  keputusan izin/cuti), ditampilkan di lonceng Dashboard app mobile
- **system_settings** — parameter sistem (koordinat kantor, radius geofencing, hari libur)
- **activity_logs** — audit trail seluruh aktivitas penting, mencatat aktor
  karyawan (`user_id`) maupun admin/pimpinan (`admin_id` + `actor_type`)

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

> Migration bersifat idempotent untuk tabel yang mungkin sudah ada secara
> manual di database kamu (`admin_accounts`, kolom `email`) — aman
> dijalankan ulang tanpa menimpa data yang sudah ada.

### 4. Jalankan server
```bash
npm run dev     # dengan nodemon (development)
npm start        # production
```

Server berjalan di `http://localhost:5000`, base URL API: `http://localhost:5000/api`.

Kalau backend diakses dari HP fisik (app mobile lewat USB) atau dari
perangkat lain di jaringan yang sama, pastikan `app.listen` mendengarkan di
`0.0.0.0`, bukan cuma `127.0.0.1`.

### Akun default (dari seeder)

| Peran | Login pakai | Username/NIP | Password |
|---|---|---|---|
| Admin | Website (username) | `admin` | `Admin@12345` |
| Pimpinan | Website (username) | `pimpinan` | `Pimpinan@12345` |
| Karyawan (contoh) | App mobile (NIP) | `KAR001` | `Karyawan@123` (wajib ganti password saat login pertama) |

## Ringkasan Endpoint API

Seluruh endpoint (kecuali login) memerlukan header `Authorization: Bearer <accessToken>`.

### Auth
| Method | Endpoint | Akses | Keterangan |
|---|---|---|---|
| POST | `/api/auth/login` | Publik | Karyawan, body `{ nip, password }` |
| POST | `/api/auth/admin-login` | Publik | Admin/Pimpinan, body `{ username, password }` |
| POST | `/api/auth/refresh-token` | Publik | |
| POST | `/api/auth/change-password` | Semua akun | body `{ oldPassword, newPassword, email? }` — `email` hanya dipakai untuk akun karyawan |
| GET | `/api/auth/me` | Semua akun | |
| POST | `/api/auth/logout` | Semua akun | |

### Pegawai/Karyawan (`/api/users`) — Admin
| Method | Endpoint |
|---|---|
| GET | `/` (query: status, search, page, limit) |
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
| POST | `/:id/notify` | Admin — kirim notifikasi in-app ke karyawan bersangkutan |
| DELETE | `/:id` | Admin |

### Notifikasi (`/api/notifications`) — karyawan (notifikasi milik sendiri)
| Method | Endpoint |
|---|---|
| GET | `/` |
| GET | `/unread-count` |
| POST | `/read-all` |

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

**Scan QR (`POST /api/attendance/scan`)** — menjalankan 4 lapis validasi:
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

**Notifikasi Piket**: Admin assign piket lewat `POST /api/piket` (belum
mengirim notifikasi apapun) → Admin menekan tombol konfirmasi "Kirim
Notifikasi" di Website, yang memanggil `POST /api/piket/:id/notify` → baris
baru dibuat di `notifications` dan `piket_schedules.notification_sent`
menjadi `true` → app mobile karyawan menampilkan badge merah di lonceng
Dashboard saat polling `GET /api/notifications/unread-count`.

**QR Code statis**: hanya satu token aktif pada satu waktu; generate/regenerasi
otomatis menonaktifkan token sebelumnya dan menghasilkan gambar PNG baru.

## Catatan

- Password disimpan ter-hash dengan bcrypt (10 rounds), baik di `users`
  maupun `admin_accounts`.
- Soft delete pada tabel `users` dan `admin_accounts` (kolom `deleted_at`)
  agar riwayat presensi/aktivitas tetap terjaga walau akunnya dihapus.
- `activity_logs` mencatat setiap aksi penting untuk kebutuhan audit trail,
  baik dari karyawan maupun admin/pimpinan.
- Notifikasi saat ini bersifat **in-app** (disimpan di tabel `notifications`,
  diambil app lewat polling `GET /api/notifications*`) — bukan push
  notification native (FCM/APNs). Kalau butuh push notification asli saat
  app di-background, itu memerlukan integrasi layanan tambahan di luar
  cakupan API ini.
- Belum ada endpoint untuk mengelola (`create`/`update`) akun
  `admin_accounts` lewat API — saat ini akun Admin/Pimpinan baru masih
  ditambahkan manual lewat database.
