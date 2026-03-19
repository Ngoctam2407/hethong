const mongoose = require('mongoose');

const sinhVienSchema = new mongoose.Schema({
    IDTaiKhoan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaiKhoan',
        required: true
    },
    MSSV: { type: String, required: true, unique: true },
    // Kết nối Sinh viên với Lớp học bằng ID tự động (_id) của bảng LopHoc
    IDLop: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'LopHoc',
        required: true
    },
    NgaySinh: Date,
    SoDienThoai: String
}, { timestamps: true });

module.exports = mongoose.model('SinhVien', sinhVienSchema);