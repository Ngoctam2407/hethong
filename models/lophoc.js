var mongoose = require('mongoose');

const LopHocSchema = new mongoose.Schema({
    MaLop: { type: String, required: true, unique: true },
    TenLop: { type: String, required: true },
    NienKhoa: String,
    NgayBatDauNamHoc: { type: Date, required: true },
    SiSo: Number,
    // Trạng thái kích hoạt giống các model khác (1 = hoạt động, 0 = tạm đóng)
    TrangThai: { type: Number, default: 1 }
});

module.exports = mongoose.model('LopHoc', LopHocSchema);