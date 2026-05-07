var mongoose = require('mongoose');

// Schema tài khoản dùng chung cho admin, giảng viên và sinh viên.
// Các thông tin riêng theo vai trò được lưu thêm ở bảng SinhVien hoặc GiangVien.
var taiKhoanSchema = new mongoose.Schema({
    HoVaTen: { type: String, required: true },
    Email: {
        type: String,
        unique: true,
        required: true,
        lowercase: true
    },
    TenDangNhap: {
        type: String,
        unique: true,
        required: true,
        trim: true
    },
    MatKhau: { type: String, required: true },
    QuyenHan: {
        type: String,
        enum: ['sinhvien', 'giangvien', 'admin'],
        default: 'sinhvien'
    },
    TrangThai: { type: Number, default: 1 },
    ThongBaoDay: {
        // Danh sách endpoint Web Push của các trình duyệt mà người dùng đã bật thông báo.
        type: [mongoose.Schema.Types.Mixed],
        default: []
    }
}, { timestamps: true });

var taiKhoanModel = mongoose.model('TaiKhoan', taiKhoanSchema);
module.exports = taiKhoanModel;
