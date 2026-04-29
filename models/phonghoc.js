var mongoose = require('mongoose');

var phongHocSchema = new mongoose.Schema({

    TenPhong: {
        type: String,
        required: true
    },

    LoaiPhong: {
        type: String,
        enum: ['LyThuyet', 'ThucHanh', 'MayTinh', 'TuVan', 'NhanSu', 'ThietBi', 'GiamDoc'],
        required: true
    },

    SucChua: {
        type: Number,
        required: true
    },

    GhiChu: String,

    KhoaThuCong: {
        type: Boolean,
        default: false
    },

    TrangThai: {
        type: Number,
        default: 1
    }

}, { timestamps: true });

module.exports = mongoose.model('PhongHoc', phongHocSchema);
