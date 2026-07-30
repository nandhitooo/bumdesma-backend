'use strict';
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

module.exports = {
  up: async (queryInterface) => {
    const now = new Date();
    const hash = (plain) => bcrypt.hashSync(plain, 10);

    await queryInterface.bulkInsert('users', [
      {
        id: uuidv4(),
        nip: 'ADM001',
        name: 'Administrator BUMDESMA',
        password: hash('Admin@12345'),
        role: 'admin',
        jabatan: 'Staff Administrasi',
        departemen: 'Administrasi',
        status: 'active',
        is_first_login: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv4(),
        nip: 'PIM001',
        name: 'Pimpinan BUMDESMA Podo Rukun LKD',
        password: hash('Pimpinan@12345'),
        role: 'pimpinan',
        jabatan: 'Ketua Pengurus',
        departemen: 'Manajemen',
        status: 'active',
        is_first_login: false,
        created_at: now,
        updated_at: now,
      },
      {
        id: uuidv4(),
        nip: 'KAR001',
        name: 'Contoh Karyawan',
        password: hash('Karyawan@123'),
        role: 'karyawan',
        jabatan: 'Staff Operasional',
        departemen: 'Operasional',
        status: 'active',
        is_first_login: true, // wajib ganti password saat login pertama
        created_at: now,
        updated_at: now,
      },
    ]);
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete(
      'users',
      { nip: ['ADM001', 'PIM001', 'KAR001'] },
      {}
    );
  },
};
