const mongoose = require('mongoose');

// Trong file models/TKB.js
const tkbSchema = new mongoose.Schema({
    // Đổi từ String sang liên kết này Tâm ơi
    MonHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'MonHoc', required: true },
    GiangVien: { type: mongoose.Schema.Types.ObjectId, ref: 'TaiKhoan', required: true },
    PhongHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'PhongHoc', required: true },
    LopHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'LopHoc', required: true },
    Thu: { type: String, required: true },
    CaHoc: { type: String, required: false, default: "" }, // Tâm có thể để trống lúc tạo, sau đó tự động gán dựa vào tiết bắt đầu
    TietBatDau: { type: Number, required: true },
    TietKetThuc: { type: Number, required: true },
    TrangThai: { type: String, enum: ['cho-duyet', 'da-duyet'], default: 'cho-duyet' },
    NgayDangKy: { type: Date, default: Date.now },
    NgayDuyet: { type: Date, default: null }
});

module.exports = mongoose.model('TKB', tkbSchema);
