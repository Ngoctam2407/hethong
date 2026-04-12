// utils/dateUtils.js
function tinhNgayTrongTuan(ngayBatDau, soThu, tuanLech = 0) {
    // soThu: 1 = Thứ 2, 2 = Thứ 3, ..., 7 = Chủ nhật
    const ngayDauTuan = new Date(ngayBatDau);
    ngayDauTuan.setDate(ngayBatDau.getDate() + (tuanLech * 7));
    const ngayThu = new Date(ngayDauTuan);
    ngayThu.setDate(ngayDauTuan.getDate() + (soThu - 1));
    return ngayThu;
}

function layTuanHienTai(ngayBatDau, ngayHienTai = new Date()) {
    const diffTime = ngayHienTai - ngayBatDau;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7);
}

module.exports = { tinhNgayTrongTuan, layTuanHienTai };