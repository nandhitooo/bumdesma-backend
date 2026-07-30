require('dotenv').config();
const app = require('./src/app');
const { sequelize } = require('./src/models');

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ Koneksi database PostgreSQL berhasil.');

    app.listen(PORT, () => {
      console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
      console.log(`   API Base URL: http://localhost:${PORT}/api`);
    });
  } catch (err) {
    console.error('❌ Gagal terkoneksi ke database:', err.message);
    process.exit(1);
  }
}

start();
