const mongoose = require('mongoose'); // THÊM DÒNG NÀY VÀO ĐẦU FILE TÂM NHÉ

const tkbSchema = new mongoose.Schema({
    MonHoc: { type: String, required: true },
    GiangVien: { type: mongoose.Schema.Types.ObjectId, ref: 'TaiKhoan', required: true },
    PhongHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'PhongHoc', required: true },
    Thu: { type: String, required: true },
    CaHoc: { type: String, required: true },
    TietBatDau: { type: Number, required: true },
    TietKetThuc: { type: Number, required: true }
});

module.exports = mongoose.model('TKB', tkbSchema);