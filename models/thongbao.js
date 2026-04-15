const mongoose = require('mongoose');

const thongBaoSchema = new mongoose.Schema({
    IDNguoiNhan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaiKhoan',
        required: true
    },
    TieuDe: { type: String, required: true }, // VD: "Lịch dạy đã được duyệt"
    NoiDung: { type: String, required: true }, // VD: "Phòng Lab 01, Thứ 2 ngày 13/04..."
    LoaiThongBao: {
        type: String,
        enum: ['lich-moi', 'nghi-day', 'he-thong'],
        default: 'he-thong'
    },
    LienKet: { type: String }, // Đường dẫn để khi click vào sẽ bay tới trang TKB
    DaXem: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('ThongBao', thongBaoSchema);

