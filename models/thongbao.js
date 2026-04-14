<<<<<<< HEAD
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
=======

const mongoose = require('mongoose');

const thongbaoSchema = new mongoose.Schema({
  title: String,
  startDate: Date,
  endDate: Date,
  description: String,
  notified: { type: Boolean, default: false }
});

// Dòng export - cần đổi tên model ở đây
module.exports = mongoose.model('thongbao', thongbaoSchema); 
>>>>>>> 6b11349c10d2757350ac6d9a4c017c6f17ef0f24
