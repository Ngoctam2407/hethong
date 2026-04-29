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

function duaVeThuHai(ngayGoc) {
    const ngay = new Date(ngayGoc);
    if (Number.isNaN(ngay.getTime())) {
        return null;
    }

    const thu = ngay.getDay();
    ngay.setDate(ngay.getDate() - (thu === 0 ? 6 : thu - 1));
    ngay.setHours(0, 0, 0, 0);
    return ngay;
}

function taoDuLieuTuanHoc(ngayBatDauNamHoc, selectedTuan, tongSoTuan = 15) {
    let mocBatDau = duaVeThuHai(ngayBatDauNamHoc || new Date());
    if (!mocBatDau) {
        mocBatDau = duaVeThuHai(new Date());
    }

    const today = new Date();
    let autoWeek = 1;
    const weeks = [];

    for (let i = 0; i < tongSoTuan; i++) {
        const wStart = new Date(mocBatDau);
        wStart.setDate(mocBatDau.getDate() + i * 7);

        const wEnd = new Date(wStart);
        wEnd.setDate(wStart.getDate() + 6);

        if (today >= wStart && today <= new Date(wEnd.getTime() + 86400000)) {
            autoWeek = i + 1;
        }

        weeks.push({
            number: i + 1,
            label: `Tuan ${i + 1} (${wStart.getDate().toString().padStart(2, '0')}/${(wStart.getMonth() + 1).toString().padStart(2, '0')} - ${wEnd.getDate().toString().padStart(2, '0')}/${(wEnd.getMonth() + 1).toString().padStart(2, '0')})`
        });
    }

    return {
        weeks,
        currentWeek: parseInt(selectedTuan, 10) || autoWeek,
        realCurrentWeek: autoWeek,
        startPoint: mocBatDau
    };
}

module.exports = { tinhNgayTrongTuan, layTuanHienTai, duaVeThuHai, taoDuLieuTuanHoc };
