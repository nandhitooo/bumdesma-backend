const { DataTypes, Model } = require('sequelize');
const sequelize = require('../config/database');
const { ROLES, USER_STATUS } = require('../utils/constants');

class User extends Model {
  static associate(models) {
    User.hasMany(models.Attendance, { foreignKey: 'user_id', as: 'attendances' });
    User.hasMany(models.Leave, { foreignKey: 'user_id', as: 'leaves' });
    User.hasMany(models.PiketSchedule, { foreignKey: 'user_id', as: 'piketSchedules' });
    User.hasMany(models.ActivityLog, { foreignKey: 'user_id', as: 'activityLogs' });
    User.hasMany(models.Leave, { foreignKey: 'reviewed_by', as: 'leavesReviewed' });
    User.hasMany(models.Leave, { foreignKey: 'decided_by', as: 'leavesDecided' });
  }

  toSafeJSON() {
    const { password, ...safe } = this.toJSON();
    return safe;
  }
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    nip: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
      comment: 'Nomor Induk Pegawai, dipakai sebagai username login',
    },
    name: {
      type: DataTypes.STRING(150),
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(...Object.values(ROLES)),
      allowNull: false,
      defaultValue: ROLES.KARYAWAN,
    },
    jabatan: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    departemen: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(...Object.values(USER_STATUS)),
      allowNull: false,
      defaultValue: USER_STATUS.ACTIVE,
    },
    is_first_login: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'True jika karyawan masih memakai password sementara dari Admin',
    },
    last_login_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    paranoid: true, // soft delete -> deleted_at
  }
);

module.exports = User;
