var mongoose = require('mongoose');

// Schema lớp học: lưu niên khóa, sĩ số và danh sách môn học được phép xếp lịch.
const LopHocSchema = new mongoose.Schema({
    MaLop: { type: String, required: true, unique: true },
    TenLop: { type: String, required: true },
    NienKhoa: String,
    NgayBatDauNamHoc: { type: Date, required: true },
    NgayKetThucNamHoc: { type: Date },
    SiSo: Number,
    DanhSachMonHoc: [{
        // Mỗi lớp chỉ được đăng ký những môn nằm trong danh sách này.
        type: mongoose.Schema.Types.ObjectId,
        ref: 'MonHoc'
    }],
    TrangThai: { type: Number, default: 1 }
});

module.exports = mongoose.model('LopHoc', LopHocSchema);
