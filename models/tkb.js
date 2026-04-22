const mongoose = require('mongoose');

// Trong file models/TKB.js
const tkbSchema = new mongoose.Schema({
    // Đổi từ String sang liên kết này Tâm ơi
    MonHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'MonHoc', required: true },
    GiangVien: { type: mongoose.Schema.Types.ObjectId, ref: 'TaiKhoan', required: true },
    PhongHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'PhongHoc', required: true },
    LopHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'LopHoc', required: true },
    Thu: { type: String, required: true },
    Tuan: { type: Number, required: true, default: 1 },
    CaHoc: { type: String, required: false, default: "" }, // Tâm có thể để trống lúc tạo, sau đó tự động gán dựa vào tiết bắt đầu
    TietBatDau: { type: Number, required: true },
    TietKetThuc: { type: Number, required: true },
    TrangThai: { type: String, enum: ['cho-duyet', 'da-duyet', 'tu-choi'], default: 'cho-duyet' },
    NgayDangKy: { type: Date, default: Date.now },
    NgayHoc: { type: Date, default: null },
    NgayDuyet: { type: Date, default: null }
});

// ⚠️ FIX: Thêm compound unique indexes để ngăn chặn collision
// Giảng viên không được dạy 2 lớp cùng 1 thời gian
tkbSchema.index({
    GiangVien: 1,
    Thu: 1,
    Tuan: 1,
    TietBatDau: 1,
    TietKetThuc: 1,
    TrangThai: 1
}, {
    unique: true,
    partialFilterExpression: { TrangThai: 'da-duyet' }
});

// Phòng học không được dùng cho 2 lớp cùng 1 thời gian
tkbSchema.index({
    PhongHoc: 1,
    Thu: 1,
    Tuan: 1,
    TietBatDau: 1,
    TietKetThuc: 1,
    TrangThai: 1
}, {
    unique: true,
    partialFilterExpression: { TrangThai: 'da-duyet' }
});

// Lớp học không được có 2 môn khác nhau cùng 1 thời gian
tkbSchema.index({
    LopHoc: 1,
    Thu: 1,
    Tuan: 1,
    TietBatDau: 1,
    TietKetThuc: 1,
    TrangThai: 1
}, {
    unique: true,
    partialFilterExpression: { TrangThai: 'da-duyet' }
});

module.exports = mongoose.model('TKB', tkbSchema);
