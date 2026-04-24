const mongoose = require('mongoose');

const giangVienSchema = new mongoose.Schema({
    IDTaiKhoan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaiKhoan',
        required: true
    },
    MaGV: { type: String, required: true, unique: true },
    HocVi: {
        type: String,
        required: true,
        enum: {
            values: ['Thạc sĩ', 'Tiến sĩ', 'Kỹ sư', 'Cử nhân', 'Giảng viên'],
            message: '{VALUE} khong nam trong danh sach hoc vi cho phep.'
        },
        default: 'Giảng viên'
    },
    LinhVuc: { type: String },
    ChuyenNganh: { type: String },
    SoDienThoai: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('GiangVien', giangVienSchema);
