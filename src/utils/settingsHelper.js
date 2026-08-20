const { SystemSetting } = require('../models');

/**
 * Mengambil seluruh baris system_settings dan mengembalikannya sebagai object key-value.
 * Nilai numerik yang valid otomatis dikonversi ke Number agar mudah dipakai di logika bisnis.
 */
async function getSettingsMap() {
  const rows = await SystemSetting.findAll();
  const map = {};
  for (const row of rows) {
    const asNumber = Number(row.value);
    map[row.key] = row.value !== null && !Number.isNaN(asNumber) && row.value.trim() !== ''
      ? asNumber
      : row.value;
  }
  return map;
}

async function getSetting(key, fallback = null) {
  const row = await SystemSetting.findOne({ where: { key } });
  return row ? row.value : fallback;
}

async function setSetting(key, value, description) {
  const [row] = await SystemSetting.findOrCreate({
    where: { key },
    defaults: { value: String(value), description },
  });
  row.value = String(value);
  if (description) row.description = description;
  await row.save();
  return row;
}

module.exports = { getSettingsMap, getSetting, setSetting };
