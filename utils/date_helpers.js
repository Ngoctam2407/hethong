var LopHoc = require('../models/lophoc');

function thuToOffset(thu) {
    const map = {
        'Thứ 2': 0,
        'Thứ 3': 1,
        'Thứ 4': 2,
        'Thứ 5': 3,
        'Thứ 6': 4,
        'Thứ 7': 5,
        'Chủ Nhật': 6
    };
    return typeof map[thu] === 'number' ? map[thu] : 0;
}

async function tinhNgayHoc(tuan, thu, lopHocId) {
    const lop = await LopHoc.findById(lopHocId).select('NgayBatDauNamHoc');
    let moc = lop && lop.NgayBatDauNamHoc ? new Date(lop.NgayBatDauNamHoc) : new Date();

    if (Number.isNaN(moc.getTime())) {
        moc = new Date();
    }

    const thuTrongTuan = moc.getDay();
    moc.setDate(moc.getDate() - (thuTrongTuan === 0 ? 6 : thuTrongTuan - 1));
    moc.setHours(0, 0, 0, 0);
    moc.setDate(moc.getDate() + ((parseInt(tuan, 10) || 1) - 1) * 7 + thuToOffset(thu));
    return moc;
}

async function getFormattedNgayHoc(item) {
    if (item.NgayHoc) {
        return new Date(item.NgayHoc).toLocaleDateString('vi-VN');
    }
    // Nếu NgayHoc bị thiếu, tính toán lại dựa trên tuần, thứ và lớp học
    if (item.Tuan && item.Thu && item.LopHoc) {
        const lopHocId = item.LopHoc._id || item.LopHoc; // Đảm bảo lấy được ID lớp học
        if (lopHocId) {
            const calculatedNgayHoc = await tinhNgayHoc(item.Tuan, item.Thu, lopHocId);
            return new Date(calculatedNgayHoc).toLocaleDateString('vi-VN');
        }
    }
    return 'N/A'; // Trường hợp không đủ dữ liệu để tính toán
}

module.exports = {
    tinhNgayHoc,
    getFormattedNgayHoc,
    thuToOffset
};