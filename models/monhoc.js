const mongoose = require('mongoose');

const monHocSchema = new mongoose.Schema({
    TenMonHoc: { type: String, required: true },
    MaMonHoc: { type: String, required: true, unique: true }, // Ví dụ: NODEJS01
    SoTinChi: { type: Number, default: 3, min: 0, max: 5 },
    MoTa: { type: String }
});

module.exports = mongoose.model('MonHoc', monHocSchema);
