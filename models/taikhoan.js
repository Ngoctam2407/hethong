var mongoose = require('mongoose');

var taiKhoanSchema = new mongoose.Schema({
    HoVaTen: { type: String, required: true },
    Email: {
        type: String,
        unique: true,
        required: true,
        lowercase: true
    },
    TenDangNhap: {
        type: String,
        unique: true,
        required: true,
        trim: true
    },
    MatKhau: { type: String, required: true },
    QuyenHan: {
        type: String,
        enum: ['sinhvien', 'giangvien', 'admin'],
        default: 'sinhvien'
    },
    TrangThai: { type: Number, default: 1 },
    ResetPasswordToken: { type: String, default: '' },
    ResetPasswordExpires: { type: Date, default: null },
    ThongBaoDay: {
        type: [mongoose.Schema.Types.Mixed],
        default: []
    }
}, { timestamps: true });

var taiKhoanModel = mongoose.model('TaiKhoan', taiKhoanSchema);
module.exports = taiKhoanModel;
