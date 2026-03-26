const mongoose = require('mongoose');

const giangVienSchema = new mongoose.Schema({
    IDTaiKhoan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TaiKhoan',
        required: true
    },
    MaGV: { type: String, required: true, unique: true },

    // Cập nhật ở đây nè Tâm:
    HocVi: {
        type: String,
        required: true,
        enum: {
            values: ['Thạc sĩ', 'Tiến sĩ', 'Kỹ sư', 'Cử nhân', 'Giảng viên'],
            message: '{VALUE} không nằm trong danh sách học vị cho phép đâu Tâm ơi!'
        },
        default: 'Giảng viên'
    },

    LinhVuc: { type: String },
    ChuyenNganh: { type: String },
    SoDienThoai: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('GiangVien', giangVienSchema);