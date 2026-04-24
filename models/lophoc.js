var mongoose = require('mongoose');

const LopHocSchema = new mongoose.Schema({
    MaLop: { type: String, required: true, unique: true },
    TenLop: { type: String, required: true },
    NienKhoa: String,
    NgayBatDauNamHoc: { type: Date, required: true },
    SiSo: Number,
    DanhSachMonHoc: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MonHoc'
    }],
    TrangThai: { type: Number, default: 1 }
});

module.exports = mongoose.model('LopHoc', LopHocSchema);
