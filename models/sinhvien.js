const mongoose = require('mongoose');

// Schema sinh viên: liên kết tài khoản đăng nhập với lớp học và thông tin cá nhân.
const sinhVienSchema = new mongoose.Schema({
    IDTaiKhoan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaiKhoan',
        required: true
    },
    MSSV: { type: String, required: true, unique: true },
    // Kết nối sinh viên với lớp học bằng _id của bảng LopHoc.
    IDLop: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LopHoc',
        required: true
    },
    NgaySinh: Date,
    SoDienThoai: String
}, { timestamps: true });

module.exports = mongoose.model('SinhVien', sinhVienSchema);
