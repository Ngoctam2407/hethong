const mongoose = require('mongoose');

const monHocSchema = new mongoose.Schema({
    TenMonHoc: { type: String, required: true },
    MaMonHoc: { type: String, required: true, unique: true },
    TongSoTiet: { type: Number, required: true, default: 0 },
    MoTa: { type: String }
});

module.exports = mongoose.model('MonHoc', monHocSchema);
