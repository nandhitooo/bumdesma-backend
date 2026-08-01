const { Op } = require('sequelize');
const { ActivityLog, User, AdminAccount } = require('../models');
const { success } = require('../utils/response');

// GET /api/activity-logs?action=&user_id=&admin_account_id=&start=&end=&page=&limit=
const getAll = async (req, res) => {
  const { action, user_id, admin_account_id, start, end, page = 1, limit = 50 } = req.query;
  const where = {};
  if (action) where.action = action;
  if (user_id) where.user_id = user_id;
  if (admin_account_id) where.admin_account_id = admin_account_id;
  if (start && end) where.created_at = { [Op.between]: [new Date(start), new Date(end)] };

  const offset = (Number(page) - 1) * Number(limit);
  const { rows, count } = await ActivityLog.findAndCountAll({
    where,
    include: [
      { model: User, as: 'user', attributes: ['nip', 'name'] },
      { model: AdminAccount, as: 'adminAccount', attributes: ['username', 'name', 'role'] },
    ],
    order: [['created_at', 'DESC']],
    limit: Number(limit),
    offset,
  });

  return success(res, {
    data: rows,
    meta: { total: count, page: Number(page), limit: Number(limit) },
  });
};

module.exports = { getAll };
