const mongoose = require('mongoose');

// Schema thông báo trong hệ thống, hiển thị ở dropdown và trang thông báo.
const thongBaoSchema = new mongoose.Schema({
    IDNguoiNhan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaiKhoan',
        required: true
    },
    TieuDe: { type: String, required: true }, // Ví dụ: "Lịch dạy đã được duyệt".
    NoiDung: { type: String, required: true }, // Ví dụ: "Phòng Lab 01, Thứ 2 ngày 13/04...".
    LoaiThongBao: {
        type: String,
        enum: ['lich-moi', 'nghi-day', 'he-thong'],
        default: 'he-thong'
    },
    LienKet: { type: String }, // Đường dẫn để mở đúng màn hình liên quan khi bấm thông báo.
    DaXem: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('ThongBao', thongBaoSchema);

