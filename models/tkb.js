const mongoose = require('mongoose');

// Schema thời khóa biểu: lưu lịch đăng ký, trạng thái duyệt và thông tin yêu cầu hủy.
const tkbSchema = new mongoose.Schema({
    MonHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'MonHoc', required: true },
    GiangVien: { type: mongoose.Schema.Types.ObjectId, ref: 'TaiKhoan', required: true },
    PhongHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'PhongHoc', required: true },
    LopHoc: { type: mongoose.Schema.Types.ObjectId, ref: 'LopHoc', required: true },
    Thu: { type: String, required: true },
    Tuan: { type: Number, required: true, default: 1 },
    CaHoc: { type: String, required: false, default: '' },
    TietBatDau: { type: Number, required: true },
    TietKetThuc: { type: Number, required: true },
    TrangThai: { type: String, enum: ['cho-duyet', 'da-duyet', 'tu-choi'], default: 'cho-duyet' },
    HuyTrangThai: { type: String, enum: ['khong', 'cho-duyet', 'da-duyet', 'tu-choi'], default: 'khong' },
    LyDoHuy: { type: String, default: '' },
    NgayDangKy: { type: Date, default: Date.now },
    NgayHoc: { type: Date, default: null },
    NgayDuyet: { type: Date, default: null },
    NgayYeuCauHuy: { type: Date, default: null },
    NgayDuyetHuy: { type: Date, default: null }
});

// Chặn giảng viên bị xếp 2 lịch đã duyệt trùng thời gian.
tkbSchema.index({
    GiangVien: 1,
    Thu: 1,
    Tuan: 1,
    TietBatDau: 1,
    TietKetThuc: 1,
    TrangThai: 1
}, {
    unique: true,
    partialFilterExpression: { TrangThai: 'da-duyet' }
});

// Chặn một phòng có 2 lịch đã duyệt trùng cùng tuần/thứ/tiết.
tkbSchema.index({
    PhongHoc: 1,
    Thu: 1,
    Tuan: 1,
    TietBatDau: 1,
    TietKetThuc: 1,
    TrangThai: 1
}, {
    unique: true,
    partialFilterExpression: { TrangThai: 'da-duyet' }
});

// Chặn trùng phòng theo ngày học thật, dùng cho các lịch đã có NgayHoc.
tkbSchema.index({
    NgayHoc: 1,
    PhongHoc: 1,
    TietBatDau: 1,
    TietKetThuc: 1,
    TrangThai: 1
}, {
    unique: true,
    partialFilterExpression: { TrangThai: 'da-duyet', NgayHoc: { $type: 'date' } }
});

// Chặn một lớp học 2 môn đã duyệt cùng lúc.
tkbSchema.index({
    LopHoc: 1,
    Thu: 1,
    Tuan: 1,
    TietBatDau: 1,
    TietKetThuc: 1,
    TrangThai: 1
}, {
    unique: true,
    partialFilterExpression: { TrangThai: 'da-duyet' }
});

module.exports = mongoose.model('TKB', tkbSchema);
