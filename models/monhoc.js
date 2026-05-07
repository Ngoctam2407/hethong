const mongoose = require('mongoose');

// Schema môn học: TongSoTiet dùng để hệ thống tự phân bổ đủ số buổi học.
const monHocSchema = new mongoose.Schema({
    TenMonHoc: { type: String, required: true },
    MaMonHoc: { type: String, required: true, unique: true },
    TongSoTiet: { type: Number, required: true, default: 0 },
    MoTa: { type: String }
});

module.exports = mongoose.model('MonHoc', monHocSchema);
