const mongoose = require('mongoose');

const giangVienSchema = new mongoose.Schema({
    IDTaiKhoan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaiKhoan',
        required: true
    },
    MaGV: { type: String, required: true, unique: true },
    HocVi: { type: String, default: 'Giảng viên' },
    // Không cố định Khoa, Tâm thích nhập gì cũng được (VD: Kế toán, Tiếng Anh, Tin học...)
    LinhVuc: { type: String },
    ChuyenNganh: { type: String },
    SoDienThoai: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('GiangVien', giangVienSchema); 