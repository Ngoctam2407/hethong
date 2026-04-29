var express = require('express');
var router = express.Router();
var mongoose = require('mongoose');
var TKB = require('../models/tkb');
var PhongHoc = require('../models/phonghoc');
var TaiKhoan = require('../models/taikhoan');
var MonHoc = require('../models/monhoc');
var GiangVien = require('../models/giangvien');
var SinhVien = require('../models/sinhvien');
var LopHoc = require('../models/lophoc');
var { sendNotification } = require('../utils/push');
var { requireAdmin } = require('./auth');
var ThongBao = require('../models/thongbao');
var { buildWorkbook, sendWorkbook } = require('../utils/excel');
var { tinhNgayHoc, getFormattedNgayHoc, thuToOffset } = require('../utils/date_helpers'); // Import tá»« tiá»‡n Ã­ch má»›i

async function calculateWeeksData(selectedTuan) {
    // TÃ¬m lá»›p há»c cÃ³ ngÃ y báº¯t Ä‘áº§u sá»›m nháº¥t, Ä‘áº£m báº£o bá» qua dá»¯ liá»‡u trá»‘ng
    const firstLop = await LopHoc.findOne({ NgayBatDauNamHoc: { $exists: true, $ne: null } }).sort({ NgayBatDauNamHoc: 1 });
    const lastLop = await LopHoc.findOne({ NgayKetThucNamHoc: { $exists: true, $ne: null } }).sort({ NgayKetThucNamHoc: -1 });

    let startPoint = (firstLop && firstLop.NgayBatDauNamHoc) ? new Date(firstLop.NgayBatDauNamHoc) : new Date();

    let totalWeeks = 20;
    if (firstLop && lastLop && lastLop.NgayKetThucNamHoc) {
        const start = new Date(firstLop.NgayBatDauNamHoc);
        const end = new Date(lastLop.NgayKetThucNamHoc);
        const diffInMs = end.getTime() - start.getTime();
        if (diffInMs > 0) {

            totalWeeks = Math.ceil(diffInMs / (7 * 24 * 60 * 60 * 1000)) + 1;
        }
    }

    // Náº¿u Ä‘á»‘i tÆ°á»£ng Date khÃ´ng há»£p lá»‡ (NaN), máº·c Ä‘á»‹nh láº¥y ngÃ y hiá»‡n táº¡i
    if (isNaN(startPoint.getTime())) {
        startPoint = new Date();
    }

    // ÄÆ°a vá» Thá»© 2 cá»§a tuáº§n khai giáº£ng
    let day = startPoint.getDay();
    startPoint.setDate(startPoint.getDate() - (day === 0 ? 6 : day - 1));
    startPoint.setHours(0, 0, 0, 0);

    let weeks = [];
    let autoWeek = 1;
    let today = new Date();

    for (let i = 0; i < totalWeeks; i++) { // Sá»­ dá»¥ng sá»‘ tuáº§n thá»±c táº¿ tÃ­nh Ä‘Æ°á»£c
        let wStart = new Date(startPoint);
        wStart.setDate(startPoint.getDate() + i * 7);
        let wEnd = new Date(wStart);
        wEnd.setDate(wStart.getDate() + 6);

        if (today >= wStart && today <= new Date(wEnd.getTime() + 86400000)) {
            autoWeek = i + 1;
        }

        weeks.push({
            number: i + 1,
            label: `Tuần ${i + 1} (${wStart.getDate().toString().padStart(2, '0')}/${(wStart.getMonth() + 1).toString().padStart(2, '0')} - ${wEnd.getDate().toString().padStart(2, '0')}/${(wEnd.getMonth() + 1).toString().padStart(2, '0')})`
        });
    }
    return { weeks, currentWeek: parseInt(selectedTuan) || autoWeek, realCurrentWeek: autoWeek };
}

async function kiemTraMonHocCuaLop(lopHocId, monHocId, session) {
    const query = LopHoc.findById(lopHocId).select('TenLop DanhSachMonHoc TrangThai');
    if (session) {
        query.session(session);
    }

    const lop = await query;
    if (!lop) {
        throw new Error('Không tìm thấy lớp học.');
    }

    if (lop.TrangThai === 0) {
        throw new Error('Lớp học đang tạm ngưng nên không thể đăng ký lịch học.');
    }

    return lop;
}

async function kiemTraPhongDangHoatDong(phongHocId, session) {
    const query = PhongHoc.findById(phongHocId).select('TenPhong KhoaThuCong');
    if (session) {
        query.session(session);
    }

    const phong = await query;
    if (!phong) {
        throw new Error('Không tìm thấy phòng học để xếp lịch học.');
    }

    if (phong.KhoaThuCong) {
        throw new Error('Phòng ' + phong.TenPhong + ' đang được khóa để sửa chữa/bảo trì.');
    }

    return phong;
}

async function taoDieuKienXungDot(thu, tuan, tietBD, tietKT, lopHocId) {
    const ngayHoc = await tinhNgayHoc(tuan, thu, lopHocId);
    return {
        ngayHoc: ngayHoc,
        query: { Thu: thu, Tuan: tuan, NgayHoc: ngayHoc, ...timeOverlap(tietBD, tietKT), TrangThai: 'da-duyet' }
    };
}

function laNgayDaQua(ngayHoc) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = new Date(ngayHoc);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate.getTime() < today.getTime();
}

function taoTrangThaiPhong(phong, busyRoomIds, lop, ngayHoc) {
    const phongId = phong._id.toString();
    const isBusy = busyRoomIds.has(phongId);
    const isMaintenance = !!phong.KhoaThuCong;
    const notEnoughCapacity = lop && Number(phong.SucChua || 0) < Number(lop.SiSo || 0);
    const isPast = laNgayDaQua(ngayHoc);

    let reason = 'Phòng trống, đủ điều kiện đăng ký học'; // Mặc định là phòng trống
    if (isPast) {
        reason = 'Ngày học đã qua';
    } else if (isMaintenance) {
        reason = 'Phòng đang bảo trì hoặc tạm khóa';
    } else if (isBusy) {
        reason = 'Phòng đã có lịch trong khung giờ này';
    } else if (notEnoughCapacity) {
        reason = 'Sức chứa ' + (phong.SucChua || 0) + ' nhỏ hơn sĩ số lớp ' + (lop ? (lop.SiSo || 0) : 0);
    }

    return {
        _id: phong._id,
        TenPhong: phong.TenPhong,
        LoaiPhong: phong.LoaiPhong,
        SucChua: phong.SucChua || 0,
        available: !isPast && !isMaintenance && !isBusy && !notEnoughCapacity,
        reason: reason,
        isBusy: isBusy,
        isMaintenance: isMaintenance,
        notEnoughCapacity: notEnoughCapacity
    };
}

async function taoThongBaoDatabaseKhiXoa(lich) {
    if (!lich || !lich.LopHoc) return;

    const monHoc = lich.MonHoc && lich.MonHoc.TenMonHoc ? lich.MonHoc.TenMonHoc : 'môn học';
    const tenLop = lich.LopHoc && lich.LopHoc.TenLop ? lich.LopHoc.TenLop : 'lớp học';

    await ThongBao.create({
        IDNguoiNhan: lich.GiangVien,
        TieuDe: 'Lịch dạy đã bị xóa',
        NoiDung: 'Lịch dạy ' + monHoc + ' của lớp ' + tenLop + ' đã bị xóa khỏi hệ thống.',
        LienKet: '/tkb'
    });

    const dsSinhVien = await SinhVien.find({ IDLop: lich.LopHoc._id || lich.LopHoc }).select('IDTaiKhoan');
    if (!dsSinhVien.length) return;

    const dsThongBao = dsSinhVien.map(function (sv) {
        return {
            IDNguoiNhan: sv.IDTaiKhoan,
            TieuDe: 'Lịch học đã bị hủy',
            NoiDung: 'Lớp ' + tenLop + ' vừa bị xóa lịch học môn ' + monHoc + '.',
            LienKet: '/tkb'
        };
    });
    await ThongBao.insertMany(dsThongBao);
}

async function taoThongBaoChoAdmin(tieuDe, noiDung, lienKet) {
    const dsAdmin = await TaiKhoan.find({ QuyenHan: 'admin', TrangThai: 1 }).select('_id').lean();
    if (!dsAdmin.length) return;

    await ThongBao.insertMany(dsAdmin.map(function (admin) {
        return {
            IDNguoiNhan: admin._id,
            TieuDe: tieuDe,
            NoiDung: noiDung,
            LoaiThongBao: 'he-thong',
            LienKet: lienKet || '/tkb/danhsach'
        };
    }));
}

async function tinhSoTietDaXep(monHocId, lopHocId, giangVienId, session) {
    const query = TKB.find({
        MonHoc: monHocId,
        LopHoc: lopHocId,
        GiangVien: giangVienId,
        TrangThai: 'da-duyet'
    }).select('TietBatDau TietKetThuc');

    if (session) {
        query.session(session);
    }

    const dsLich = await query;
    return dsLich.reduce(function (tong, lich) {
        return tong + ((lich.TietKetThuc || 0) - (lich.TietBatDau || 0) + 1);
    }, 0);
}

async function taoDanhSachBuoiHocTuDong(options) {
    const {
        monHocId,
        giangVienId,
        phongHocId,
        lopHocId,
        thu,
        tuanBatDau,
        tietBatDau,
        tietKetThuc,
        trangThai,
        session
    } = options;

    const monHoc = await MonHoc.findById(monHocId).session(session);
    if (!monHoc) {
        throw new Error('Không tìm thấy môn học để xếp lịch học.');
    }

    if (!monHoc.TongSoTiet || monHoc.TongSoTiet <= 0) {
        throw new Error('Môn học chưa có tổng số tiết nên chưa thể tự động phân bổ lịch học.');
    }

    await kiemTraPhongDangHoatDong(phongHocId, session);
    const lopHocInfo = await kiemTraMonHocCuaLop(lopHocId, monHocId, session);

    const soTietMoiBuoi = (tietKetThuc - tietBatDau) + 1;
    if (soTietMoiBuoi <= 0) {
        throw new Error('Khung tiết học không hợp lệ.');
    }

    const caHocTuDong = tietBatDau <= 5 ? 'Sáng' : (tietBatDau <= 10 ? 'Chiều' : 'Tối');
    const soTietDaXep = await tinhSoTietDaXep(monHocId, lopHocId, giangVienId, session);
    let soTietConLai = monHoc.TongSoTiet - soTietDaXep;

    if (soTietConLai <= 0) {
        throw new Error('Môn học này đã được xếp đủ số tiết cho lớp và giảng viên đã chọn.');
    }

    // Xác định giới hạn tuần dựa trên ngày kết thúc của lớp học này
    let limitWeek = 20;
    if (lopHocInfo && lopHocInfo.NgayBatDauNamHoc && lopHocInfo.NgayKetThucNamHoc) {
        const start = new Date(lopHocInfo.NgayBatDauNamHoc);
        const end = new Date(lopHocInfo.NgayKetThucNamHoc);
        limitWeek = Math.ceil((end.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    }

    const dsBuoi = [];
    // Lập đến giới hạn tuần của lớp hoặc tối đa 25 tuần để an toàn
    for (let week = tuanBatDau; week <= limitWeek && soTietConLai > 0; week++) {
        const ngayHoc = await tinhNgayHoc(week, thu, lopHocId);
        if (laNgayDaQua(ngayHoc)) {
            continue;
        }

        const soTietBuoiNay = Math.min(soTietMoiBuoi, soTietConLai);
        const tietKetThucBuoi = tietBatDau + soTietBuoiNay - 1;
        const conflictQuery = {
            NgayHoc: ngayHoc,
            TrangThai: 'da-duyet',
            ...timeOverlap(tietBatDau, tietKetThucBuoi)
        };

        const [gvBan, phongBan, lopBan] = await Promise.all([
            TKB.findOne({ GiangVien: giangVienId, ...conflictQuery }).session(session),
            TKB.findOne({ PhongHoc: phongHocId, ...conflictQuery }).session(session),
            TKB.findOne({ LopHoc: lopHocId, ...conflictQuery }).session(session)
        ]);

        if (gvBan || phongBan || lopBan) {
            continue;
        }

        dsBuoi.push({
            MonHoc: monHocId,
            GiangVien: giangVienId,
            LopHoc: lopHocId,
            PhongHoc: phongHocId,
            Thu: thu,
            Tuan: week,
            NgayHoc: ngayHoc,
            TietBatDau: tietBatDau,
            TietKetThuc: tietKetThucBuoi,
            CaHoc: caHocTuDong,
            TrangThai: trangThai
        });

        soTietConLai -= soTietBuoiNay;
    }

    if (soTietConLai > 0) {
        throw new Error('Không đủ tuần trong học kỳ để xếp đủ ' + monHoc.TongSoTiet + ' tiết cho môn này.');
    }

    return {
        monHoc: monHoc,
        dsBuoi: dsBuoi
    };
}


// helpers
const timeOverlap = (start, end) => ({
    $or: [
        { TietBatDau: { $lte: end }, TietKetThuc: { $gte: start } }
    ]
});

function taoNoiDungLich(lich) {
    const tenMon = lich.MonHoc && lich.MonHoc.TenMonHoc ? lich.MonHoc.TenMonHoc : 'Mon hoc';
    const tenLop = lich.LopHoc && lich.LopHoc.TenLop ? lich.LopHoc.TenLop : 'Lop hoc';
    const tenPhong = lich.PhongHoc && lich.PhongHoc.TenPhong ? lich.PhongHoc.TenPhong : 'Phong hoc';
    const tiet = `${lich.TietBatDau}-${lich.TietKetThuc}`;
    return `${tenMon} - ${tenLop} - ${lich.Thu} - tiet ${tiet} - phong ${tenPhong}`;
}

async function guiThongBaoChoTaiKhoan(taiKhoan, payload) {
    if (!taiKhoan || !Array.isArray(taiKhoan.ThongBaoDay) || !taiKhoan.ThongBaoDay.length) {
        return;
    }

    const hopLe = [];
    for (const subscription of taiKhoan.ThongBaoDay) {
        try {
            await sendNotification(subscription, payload);
            hopLe.push(subscription);
        } catch (err) {
            const maLoi = err && (err.statusCode || err.code);
            if (maLoi !== 404 && maLoi !== 410) {
                console.error(err);
                hopLe.push(subscription);
            }
        }
    }

    if (hopLe.length !== taiKhoan.ThongBaoDay.length) {
        taiKhoan.ThongBaoDay = hopLe;
        await taiKhoan.save();
    }
}

async function guiThongBaoLichHoc(loaiThongBao, lichId) {
    const lich = typeof lichId === 'object' && lichId !== null
        ? lichId
        : await TKB.findById(lichId).populate('MonHoc GiangVien LopHoc PhongHoc');
    if (!lich) return;

    const giangVien = await TaiKhoan.findById(lich.GiangVien);
    const dsSinhVien = await SinhVien.find({ IDLop: lich.LopHoc._id }).select('IDTaiKhoan');
    const dsTaiKhoanSinhVien = await TaiKhoan.find({
        _id: { $in: dsSinhVien.map(function (item) { return item.IDTaiKhoan; }) }
    });

    const url = '/tkb';
    const noiDungLich = taoNoiDungLich(lich);

    let payloadGV = null;
    let payloadSV = null;

    if (loaiThongBao === 'duyet-moi') {
        payloadGV = {
            title: 'Lịch học đã được duyệt',
            body: `Bạn có lịch dạy mới: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
        payloadSV = {
            title: 'Lịch học mới',
            body: `Lớp bạn có lịch học mới: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
    } else if (loaiThongBao === 'cap-nhat') {
        payloadGV = {
            title: 'Lịch dạy đã thay đổi',
            body: `Lịch dạy của bạn vừa được cập nhật: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
        payloadSV = {
            title: 'Lịch học đã thay đổi',
            body: `Lịch học của lớp bạn vừa được cập nhật: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
    } else if (loaiThongBao === 'huy-lich') {
        payloadGV = {
            title: 'Lịch dạy đã bị hủy',
            body: `Một lịch dạy của bạn đã bị xóa: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
        payloadSV = {
            title: 'Lịch học đã bị hủy',
            body: `Một lịch học của lớp bạn đã bị xóa: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
    }

    if (payloadGV && giangVien) {
        await guiThongBaoChoTaiKhoan(giangVien, payloadGV);
    }

    if (payloadSV && dsTaiKhoanSinhVien.length) {
        for (const taiKhoan of dsTaiKhoanSinhVien) {
            await guiThongBaoChoTaiKhoan(taiKhoan, payloadSV);
        }
    }
}

// GET: Hiá»‡n danh sÃ¡ch TKB
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;
        if (!user) return res.redirect('/auth/dangnhap');

        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);

        const dsphong = await PhongHoc.find().sort({ TenPhong: 1 });

        let query = { TrangThai: 'da-duyet' };
        query.Tuan = currentWeek;


        if (user.QuyenHan === 'SinhVien' || user.QuyenHan === 'sinhvien') {

            const thongTinSV = await SinhVien.findOne({ IDTaiKhoan: user._id });
            if (thongTinSV) {
                query.LopHoc = thongTinSV.IDLop;
            } else {
                query._id = null;
            }
        } else if (user.QuyenHan === 'GiangVien' || user.QuyenHan === 'giangvien') {
            query.GiangVien = user._id;
        }
        const thoiKhoaBieu = await TKB.find(query)
            .populate('MonHoc')
            .populate('PhongHoc')
            .populate('GiangVien')
            .populate('LopHoc')
            .sort({ Thu: 1, TietBatDau: 1 });

        const dsTKBFormatted = await Promise.all(thoiKhoaBieu.map(async item => {
            const ngayHocHienThi = await getFormattedNgayHoc(item);
            return { ...item.toObject(), NgayHocHienThi: ngayHocHienThi };
        }));

        res.render('tkb', {
            title: 'Thời khóa biểu',
            user,
            dsphong: dsphong,
            cacThu: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'],
            cacBuoi: ['Sáng', 'Chiều', 'Tối'],
            dsTKB: dsTKBFormatted, // Gá»­i danh sÃ¡ch Ä‘Ã£ cÃ³ ngÃ y Ä‘á»‹nh dáº¡ng
            currentWeek,
            weeks,
            realCurrentWeek
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lá»—i há»‡ thá»‘ng rá»“i.");
    }
});

// GET: Hiá»‡n trang thÃªm TKB
router.post('/them', async (req, res) => {
    // âš ï¸ FIX: Sá»­ dá»¥ng transaction Ä‘á»ƒ Ä‘áº£m báº£o atomicity
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { MonHoc: monHocInput, GiangVien, PhongHoc: phongHocID, LopHoc: lopHocID, Thu, TietBatDau, TietKetThuc, Tuan: tuanInput } = req.body;
        const tietBD = parseInt(TietBatDau, 10);
        const tietKT = parseInt(TietKetThuc, 10);
        const Tuan = parseInt(tuanInput, 10) || 1;

        // Cháº¥p nháº­n cáº£ 1 ID mÃ´n hoáº·c 1 máº£ng ID mÃ´n
        const monHocIds = Array.isArray(monHocInput) ? monHocInput : [monHocInput];

        const { realCurrentWeek } = await calculateWeeksData();
        if (Tuan < realCurrentWeek) {
            await session.abortTransaction();
            req.session.error = "KhÃ´ng thá»ƒ thÃªm lá»‹ch vÃ o cÃ¡c tuáº§n trong quÃ¡ khá»©.";
            return res.redirect('back');
        }

        // âš ï¸ FIX: Validate dá»¯ liá»‡u input
        if (tietKT < tietBD) {
            await session.abortTransaction();
            req.session.error = "Tiáº¿t káº¿t thÃºc pháº£i >= tiáº¿t báº¯t Ä‘áº§u";
            return res.redirect('back');
        }

        const [lop, phong] = await Promise.all([
            LopHoc.findById(lopHocID).session(session),
            kiemTraPhongDangHoatDong(phongHocID, session)
        ]);

        if (phong && lop && phong.SucChua < lop.SiSo) {
            await session.abortTransaction();
            req.session.error = `PhÃ²ng ${phong.TenPhong} chá»‰ chá»©a Ä‘Æ°á»£c ${phong.SucChua} báº¡n, mÃ  lá»›p nÃ y táº­n ${lop.SiSo} báº¡n láº­n TÃ¢m áº¡!`;
            return res.redirect('back');
        }

        let tongSoBuoi = 0;
        let cacMonDaXep = [];

        for (const mId of monHocIds) {
            const ketQuaXep = await taoDanhSachBuoiHocTuDong({
                monHocId: mId,
                giangVienId: GiangVien,
                phongHocId: phongHocID,
                lopHocId: lopHocID,
                thu: Thu,
                tuanBatDau: Tuan,
                tietBatDau: tietBD,
                tietKetThuc: tietKT,
                trangThai: 'da-duyet',
                session: session
            });

            if (ketQuaXep.dsBuoi.length > 0) {
                await TKB.insertMany(ketQuaXep.dsBuoi, { session: session });
                tongSoBuoi += ketQuaXep.dsBuoi.length;
                cacMonDaXep.push(ketQuaXep.monHoc.TenMonHoc);
            }
        }

        await session.commitTransaction();
        req.session.success = `Đã tự động phân bổ ${tongSoBuoi} buổi học cho các môn: ${cacMonDaXep.join(', ')}`;

        res.redirect('/tkb');

    } catch (err) {
        await session.abortTransaction();
        console.error(err);

        if (err.code === 11000) {
            req.session.error = "Lịch này bị trùng! Có thể do xung đột dữ liệu.";
        } else {
            req.session.error = "Lỗi xử lý logic: " + err.message;
        }
        res.redirect('back');
    } finally {
        await session.endSession();
    }
});


// GET: Hiá»‡n trang thÃªm TKB (Admin)
router.get('/them', requireAdmin, async (req, res) => {
    try {
        const [dsmon, dsgiangvien, dslop, dsphong] = await Promise.all([
            MonHoc.find(),
            TaiKhoan.find({ QuyenHan: 'giangvien' }),
            LopHoc.find({ TrangThai: 1 }).populate('DanhSachMonHoc').lean(), // Sá»­ dá»¥ng lean() Ä‘á»ƒ dá»… dÃ ng xá»­ lÃ½ á»Ÿ JS frontend
            PhongHoc.find()
        ]);
        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);
        res.render('tkb_them', {
            title: 'Táº¡o Thá»i KhÃ³a Biá»ƒu Má»›i',
            dsmon,
            dsgiangvien,
            dslop,
            dsphong,
            weeks,
            currentWeek,
            realCurrentWeek
        });
    } catch (err) {
        res.status(500).send("Lá»—i táº£i trang thÃªm: " + err);
    }
});

// GET: Hiá»‡n trang Sá»­a TKB
router.get('/sua/:id', async (req, res) => {
    try {
        const item = await TKB.findById(req.params.id);
        const dsPhong = await PhongHoc.find();
        const dsGiangVien = await TaiKhoan.find({ QuyenHan: 'giangvien' });
        const dsMonHoc = await MonHoc.find();
        const dsLopHoc = await LopHoc.find().populate('DanhSachMonHoc');
        const { weeks } = await calculateWeeksData(item.Tuan);

        res.render('tkb_sua', {
            title: 'Chá»‰nh Sá»­a Lá»‹ch Há»c',
            tkb: item,
            dsPhong: dsPhong,
            dsGiangVien: dsGiangVien,
            dsMonHoc: dsMonHoc,
            dsLopHoc: dsLopHoc,
            weeks
        });
    } catch (err) {
        res.send("Lá»—i khÃ´ng tÃ¬m tháº¥y lá»‹ch Ä‘á»ƒ sá»­a TÃ¢m Æ¡i: " + err);
    }
});

// POST: Cáº­p nháº­t TKB sau khi sá»­a
router.post('/sua/:id', async (req, res) => {
    // âš ï¸ FIX: Sá»­ dá»¥ng transaction Ä‘á»ƒ Ä‘áº£m báº£o consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { MonHoc: monHocID, LopHoc: lopHocID, TietBatDau, PhongHoc: phongMoiID, Thu, Tuan, TietKetThuc } = req.body;
        const tietBD = parseInt(TietBatDau, 10);
        const tietKT = parseInt(TietKetThuc, 10);

        const { realCurrentWeek } = await calculateWeeksData();
        if (parseInt(Tuan) < realCurrentWeek) {
            await session.abortTransaction();
            req.session.error = "KhÃ´ng thá»ƒ chá»‰nh sá»­a lá»‹ch á»Ÿ cÃ¡c tuáº§n trong quÃ¡ khá»©.";
            return res.redirect('back');
        }

        // âš ï¸ FIX: Validate input
        if (tietKT < tietBD) {
            await session.abortTransaction();
            req.session.error = "Tiáº¿t káº¿t thÃºc pháº£i >= tiáº¿t báº¯t Ä‘áº§u";
            return res.redirect('back');
        }

        const lichCu = await TKB.findById(req.params.id).session(session);
        if (!lichCu) {
            await session.abortTransaction();
            return res.send("KhÃ´ng tÃ¬m tháº¥y lá»‹ch nÃ y.");
        }

        const ngayHocMoi = await tinhNgayHoc(Tuan, Thu, lopHocID);
        if (laNgayDaQua(ngayHocMoi)) {
            await session.abortTransaction();
            req.session.error = 'KhÃ´ng thá»ƒ chuyá»ƒn lá»‹ch vá» tuáº§n cÅ© hoáº·c ngÃ y Ä‘Ã£ qua.';
            return res.redirect('back');
        }

        await kiemTraMonHocCuaLop(lopHocID, monHocID, session);

        const thuDaThayDoi = lichCu.Thu !== Thu;
        const tietDaThayDoi = lichCu.TietBatDau !== tietBD || lichCu.TietKetThuc !== tietKT;
        const tuanDaThayDoi = lichCu.Tuan !== parseInt(Tuan, 10);
        const phongDaThayDoi = lichCu.PhongHoc.toString() !== phongMoiID;

        if ((thuDaThayDoi || tietDaThayDoi || tuanDaThayDoi || phongDaThayDoi) && lichCu.TrangThai === 'da-duyet') {
            const conflictQuery = {
                Thu,
                Tuan: parseInt(Tuan, 10),
                NgayHoc: ngayHocMoi,
                ...timeOverlap(tietBD, tietKT),
                TrangThai: 'da-duyet',
                _id: { $ne: req.params.id }
            };

            // Kiá»ƒm tra xung Ä‘á»™t giáº£ng viÃªn
            const gvConflict = await TKB.findOne({
                GiangVien: lichCu.GiangVien,
                ...conflictQuery
            }).session(session);

            if (gvConflict) {
                await session.abortTransaction();
                req.session.error = "Giáº£ng viÃªn nÃ y Ä‘Ã£ cÃ³ lá»‹ch khÃ¡c vÃ o khung giá» má»›i nÃ y";
                return res.redirect('back');
            }

            // Kiá»ƒm tra xung Ä‘á»™t phÃ²ng (náº¿u Ä‘á»•i phÃ²ng)
            if (phongDaThayDoi) {
                const phongConflict = await TKB.findOne({
                    PhongHoc: phongMoiID,
                    ...conflictQuery
                }).session(session);

                if (phongConflict) {
                    await session.abortTransaction();
                    req.session.error = "PhÃ²ng má»›i nÃ y Ä‘Ã£ báº­n vÃ o khung giá» má»›i";
                    return res.redirect('back');
                }
            }

            // Kiá»ƒm tra xung Ä‘á»™t lá»›p
            const lopConflict = await TKB.findOne({
                LopHoc: lopHocID,
                ...conflictQuery
            }).session(session);

            if (lopConflict) {
                await session.abortTransaction();
                req.session.error = "Lá»›p nÃ y Ä‘Ã£ cÃ³ mÃ´n khÃ¡c vÃ o khung giá» má»›i";
                return res.redirect('back');
            }
        }

        // âš ï¸ FIX: Náº¿u Ä‘á»•i phÃ²ng, kiá»ƒm tra sá»©c chá»©a
        if (phongDaThayDoi) {
            await kiemTraPhongDangHoatDong(phongMoiID, session);
            const phong = await PhongHoc.findById(phongMoiID).session(session);
            const lop = await LopHoc.findById(lopHocID).session(session);

            if (phong && lop && phong.SucChua < lop.SiSo) {
                await session.abortTransaction();
                req.session.error = `PhÃ²ng ${phong.TenPhong} chá»‰ chá»©a ${phong.SucChua}, lá»›p cÃ³ ${lop.SiSo} sinh viÃªn!`;
                return res.redirect('back');
            }
        }

        // âš ï¸ FIX: Cáº­p nháº­t LÆ¯U Lá»šP CA Há»ŒC TRONG TRANSACTION
        const caHocTuDong = tietBD <= 5 ? 'SÃ¡ng' : (tietBD <= 10 ? 'Chiá»u' : 'Tá»‘i');
        await TKB.findByIdAndUpdate(
            req.params.id,
            { ...req.body, NgayHoc: ngayHocMoi, CaHoc: caHocTuDong },
            { session }
        );

        // âš ï¸ FIX: Náº¿u Ä‘á»•i phÃ²ng, cáº­p nháº­t tráº¡ng thÃ¡i cáº£ phÃ²ng cÅ© vÃ  phÃ²ng má»›i
        await session.commitTransaction();

        if (lichCu.TrangThai === 'da-duyet') {
            await guiThongBaoLichHoc('cap-nhat', req.params.id);
        }

        req.session.success = "Cáº­p nháº­t lá»‹ch há»c thÃ nh cÃ´ng.";
        res.redirect('/tkb');
    } catch (err) {
        await session.abortTransaction();
        console.error(err);
        req.session.error = "Lá»—i cáº­p nháº­t: " + err.message;
        res.redirect('back');
    } finally {
        await session.endSession();
    }
});

// GET: XÃ³a TKB
router.get('/xoa/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const lichCu = await TKB.findById(id).populate('MonHoc LopHoc PhongHoc');

        const { realCurrentWeek } = await calculateWeeksData();
        if (lichCu && lichCu.Tuan < realCurrentWeek) {
            req.session.error = "Lá»‹ch trong quÃ¡ khá»© khÃ´ng Ä‘Æ°á»£c phÃ©p xÃ³a.";
            return res.redirect('/tkb');
        }

        await TKB.findByIdAndDelete(id);

        if (lichCu && lichCu.TrangThai === 'da-duyet') {
            await taoThongBaoDatabaseKhiXoa(lichCu);
            await guiThongBaoLichHoc('huy-lich', lichCu);
        }

        res.redirect('/tkb');
    } catch (err) {
        console.error(err);
        res.status(500).send("Loi xoa lich.");
    }
});

router.get('/thoi-khoa-bieu-luoi', async (req, res) => {
    try {
        const user = req.session.user;
        if (!user) return res.redirect('/auth/dangnhap');

        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);
        // 1. Khá»Ÿi táº¡o query máº·c Ä‘á»‹nh
        let query = { TrangThai: 'da-duyet' };
        query.Tuan = currentWeek;

        // 2. PHÃ‚N LUá»’NG: TÃ¢m lÆ°u Ã½ chá»— nÃ y Ä‘á»ƒ hiá»‡n Ä‘Ãºng lá»‹ch tá»«ng ngÆ°á»i nhÃ©
        if (user.QuyenHan === 'sinhvien') {
            // VÃ¬ báº£ng TaiKhoan khÃ´ng cÃ³ LopHoc, mÃ¬nh cáº§n tÃ¬m á»Ÿ báº£ng SinhVien Ä‘á»ƒ láº¥y ID lá»›p
            const thongTinSV = await require('../models/sinhvien').findOne({ IDTaiKhoan: user._id });
            if (thongTinSV) query.LopHoc = thongTinSV.IDLop;
        } else if (user.QuyenHan === 'giangvien') {
            // Giáº£ng viÃªn thÃ¬ lá»c theo ID tÃ i khoáº£n cá»§a há»
            query.GiangVien = user._id;
        }

        // 3. Láº¥y dá»¯ liá»‡u vÃ  dÃ¹ng .populate Ä‘á»ƒ "Ä‘á»• Ä‘áº§y" thÃ´ng tin
        const [dsLich, dsphong] = await Promise.all([
            TKB.find(query).populate('MonHoc PhongHoc GiangVien LopHoc'),
            PhongHoc.find().sort({ TenPhong: 1 })
        ]);

        // 4. Tá»‘i Æ°u Ä‘oáº¡n tÃ­nh ThuIndex (DÃ¹ng Object thay vÃ¬ if/else dÃ i dÃ²ng)
        const thuMap = { 'Thá»© 2': 2, 'Thá»© 3': 3, 'Thá»© 4': 4, 'Thá»© 5': 5, 'Thá»© 6': 6, 'Thá»© 7': 7, 'Chá»§ Nháº­t': 8 };

        const dsTKB = await Promise.all(dsLich.map(async item => {
            const ngayHocHienThi = await getFormattedNgayHoc(item);
            return {
                ...item._doc, ThuIndex: thuMap[item.Thu] || 2, SoTiet: ((item.TietKetThuc || 0) - (item.TietBatDau || 0)) + 1, NgayHocHienThi: ngayHocHienThi
            };
        }));

        res.render('tkb', {
            title: 'Thá»i KhÃ³a Biá»ƒu Cá»§a TÃ´i',
            dsTKB: dsTKB,
            dsphong: dsphong,
            user: user,
            currentWeek,
            weeks
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lá»—i lÆ°á»›i rá»“i TÃ¢m Æ¡i: " + err.message);
    }
});

// Trong file routers/taikhoan.js
// Route hiá»ƒn thá»‹ trang Ä‘Äƒng kÃ½
router.get('/dangky', async (req, res) => {
    try {
        const user = req.session.user;
        if (!user) return res.redirect('/auth/dangnhap');
        if (user.QuyenHan === 'sinhvien') {
            req.session.error = 'Sinh viÃªn khÃ´ng cÃ³ quyá»n Ä‘Äƒng kÃ½ lá»‹ch há»c.';
            return res.redirect('/tkb');
        }

        // TÃ¢m lÆ°u Ã½: Trong Database em dÃ¹ng 'QuyenHan' (khÃ´ng dÃ¹ng 'role')
        // MÃ¬nh Ä‘ang dÃ¹ng field QuyenHan trong collection TaiKhoan
        const dsGiangVien = await TaiKhoan.find({ QuyenHan: 'giangvien' });
        const dsMon = await MonHoc.find();
        const dsPhong = await PhongHoc.find();

        // Sá»­a lá»—i á»Ÿ Ä‘Ã¢y: DÃ¹ng LopHoc (Ä‘Ã£ require á»Ÿ dÃ²ng 7) thay vÃ¬ Lop
        const dsLop = await LopHoc.find().populate('DanhSachMonHoc');
        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);

        res.render('tkb_dangky', {
            title: 'ÄÄƒng kÃ½ há»c pháº§n Edu KT',
            user,
            dsmon: dsMon,
            dsphong: dsPhong,
            dsgiangvien: dsGiangVien,
            dslop: dsLop,
            weeks,
            currentWeek,
            realCurrentWeek
        });
    } catch (err) {
        console.error("Lá»—i lá»c dá»¯ liá»‡u TÃ¢m Æ¡i:", err);
        res.status(500).send("Lá»—i rá»“i. Kiá»ƒm tra Terminal xem lá»—i gÃ¬ nha.");
    }
});

router.post('/dang-ky-luu', async (req, res) => {
    // âš ï¸ FIX: Sá»­ dá»¥ng MongoDB Session Ä‘á»ƒ táº¡o transaction
    // Äiá»u nÃ y giÃºp trÃ¡nh race condition khi nhiá»u ngÆ°á»i Ä‘Äƒng kÃ½ cÃ¹ng lÃºc
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const user = req.session.user;
        if (!user) {
            await session.abortTransaction();
            return res.redirect('/auth/dangnhap');
        }
        if (user.QuyenHan === 'sinhvien') {
            await session.abortTransaction();
            req.session.error = 'Sinh viÃªn khÃ´ng cÃ³ quyá»n Ä‘Äƒng kÃ½ lá»‹ch há»c.';
            return res.redirect('/tkb');
        }

        // Äá»•i tÃªn biáº¿n láº¥y tá»« body Ä‘á»ƒ khÃ´ng trÃ¹ng vá»›i tÃªn Model (thÃªm chá»¯ ID vÃ o sau)
        const {
            MonHoc: monHocID,
            GiangVien: giangVienIdTuForm,
            LopHoc: lopHocID,
            Thu,
            Tuan,
            TietBatDau,
            TietKetThuc,
            PhongHoc: phongHocID
        } = req.body;

        const giangVienID = user.QuyenHan === 'giangvien' ? user._id : giangVienIdTuForm;

        const tietBD = parseInt(TietBatDau, 10);
        const tietKT = parseInt(TietKetThuc, 10);
        const tuanInt = parseInt(Tuan, 10);

        const { realCurrentWeek } = await calculateWeeksData();
        if (tuanInt < realCurrentWeek) {
            await session.abortTransaction();
            req.session.error = 'KhÃ´ng thá»ƒ Ä‘Äƒng kÃ½ lá»‹ch cho cÃ¡c tuáº§n Ä‘Ã£ qua.';
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        if (tietKT < tietBD) {
            await session.abortTransaction();
            req.session.error = "Tiáº¿t káº¿t thÃºc pháº£i >= tiáº¿t báº¯t Ä‘áº§u";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        const { ngayHoc, query: conflictQuery } = await taoDieuKienXungDot(Thu, tuanInt, tietBD, tietKT, lopHocID);
        if (laNgayDaQua(ngayHoc)) {
            await session.abortTransaction();
            req.session.error = 'Chá»‰ Ä‘Æ°á»£c Ä‘Äƒng kÃ½ cho ngÃ y má»›i, khÃ´ng cho Ä‘Äƒng kÃ½ tuáº§n cÅ©.';
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        await kiemTraMonHocCuaLop(lopHocID, monHocID, session);

        // âš ï¸ FIX: RE-CHECK xung Ä‘á»™t BÃŠN TRONG transaction (láº§n thá»© 2)
        // Láº§n nÃ y sáº½ lock dá»¯ liá»‡u, nÃªn nÃ³ sáº½ cháº¯c cháº¯n detect Ä‘Æ°á»£c náº¿u cÃ³ trÃ¹ng
        const [gvConflict, roomConflict, lopConflict] = await Promise.all([
            TKB.findOne({ GiangVien: giangVienID, ...conflictQuery }).session(session),
            TKB.findOne({ PhongHoc: phongHocID, ...conflictQuery }).session(session),
            TKB.findOne({ LopHoc: lopHocID, ...conflictQuery }).session(session)
        ]);

        if (gvConflict) {
            await session.abortTransaction();
            req.session.error = "Giáº£ng viÃªn Ä‘ang sáº¯p cÃ³ lá»‹ch dáº¡y giá» nÃ y";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }
        if (roomConflict) {
            await session.abortTransaction();
            req.session.error = "PhÃ²ng Ä‘ang dÃ¹ng giá» nÃ y";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }
        if (lopConflict) {
            await session.abortTransaction();
            req.session.error = "Lá»›p nÃ y Ä‘Ã£ lá»›p khÃ¡c dáº¡y giá» nÃ y rá»“i , nÃªn khÃ´ng Ä‘Æ°á»£c Ä‘Äƒng kÃ½ Ä‘Ã¢u nhÃ©.";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        const lop = await LopHoc.findById(lopHocID).session(session);
        const phong = await kiemTraPhongDangHoatDong(phongHocID, session);

        if (phong && lop && phong.SucChua < lop.SiSo) {
            await session.abortTransaction();
            req.session.error = `PhÃ²ng ${phong.TenPhong} chá»‰ chá»©a ${phong.SucChua}, Lá»›p cÃ³ táº­n ${lop.SiSo} sinh viÃªn!`;
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        const caHocTuDong = tietBD <= 5 ? 'SÃ¡ng' : (tietBD <= 10 ? 'Chiá»u' : 'Tá»‘i');

        const lichMoi = new TKB({
            MonHoc: monHocID,
            GiangVien: giangVienID,
            LopHoc: lopHocID,
            Thu,
            Tuan: tuanInt,
            NgayHoc: ngayHoc,
            TietBatDau: tietBD,
            TietKetThuc: tietKT,
            PhongHoc: phongHocID,
            CaHoc: caHocTuDong,
            TrangThai: 'cho-duyet'
        });

        // âš ï¸ FIX: LÆ°u trong transaction (sáº½ rollback náº¿u cÃ³ lá»—i)
        await lichMoi.save({ session });

        // âš ï¸ FIX: Commit transaction sau khi táº¥t cáº£ thÃ nh cÃ´ng
        await session.commitTransaction();

        const [monThongBao, gvThongBao] = await Promise.all([
            MonHoc.findById(monHocID).select('TenMonHoc').lean(),
            TaiKhoan.findById(giangVienID).select('HoVaTen').lean()
        ]);

        await taoThongBaoChoAdmin(
            'Có đăng ký lịch mới chờ duyệt',
            (gvThongBao ? gvThongBao.HoVaTen : 'Giảng viên') + ' vừa đăng ký lịch ' +
            (monThongBao ? monThongBao.TenMonHoc : 'môn học') + ' cho lớp ' +
            (lop ? lop.TenLop : 'lớp học') + ', ' + Thu + ', tiết ' + tietBD + '-' + tietKT + '.',
            '/tkb/danhsach?tuan=' + tuanInt
        );

        req.session.success = "ÄÃ£ lÆ°u lá»‹ch rá»“i, chá» duyá»‡t nhÃ©!";
        res.redirect('/tkb');
    } catch (err) {
        // âš ï¸ FIX: Rollback náº¿u cÃ³ báº¥t ká»³ lá»—i nÃ o
        await session.abortTransaction();
        console.error(err);

        // PhÃ¡t hiá»‡n lá»—i unique constraint (duplicate)
        if (err.code === 11000) {
            req.session.error = "Lá»‹ch nÃ y Ä‘Ã£ bá»‹ xung Ä‘á»™t! CÃ³ thá»ƒ do nhiá»u ngÆ°á»i Ä‘Äƒng kÃ½ cÃ¹ng lÃºc. Vui lÃ²ng thá»­ láº¡i.";
        } else {
            req.session.error = "Lá»—i server: " + err.message;
        }
        res.redirect(req.get('referer') || '/tkb/dangky');
    } finally {
        // âš ï¸ FIX: LuÃ´n luÃ´n close session sau khi hoÃ n thÃ nh
        await session.endSession();
    }
});

// API kiá»ƒm tra danh sÃ¡ch phÃ²ng báº­n Ä‘á»ƒ khÃ³a á»Ÿ giao diá»‡n
router.get('/api/check-phong-ban', async (req, res) => {
    try {
        const { tuan, thu, tietBD, tietKT, lopHocID } = req.query;
        // Náº¿u thiáº¿u thÃ´ng tin thÃ¬ tráº£ vá» máº£ng rá»—ng (khÃ´ng khÃ³a phÃ²ng nÃ o)
        if (!tuan || !thu || !tietBD || !tietKT || !lopHocID) {
            return res.json([]);
        }

        const ngayHoc = await tinhNgayHoc(parseInt(tuan), thu, lopHocID);
        const query = {
            NgayHoc: ngayHoc,
            TrangThai: 'da-duyet',
            ...timeOverlap(parseInt(tietBD), parseInt(tietKT))
        };

        const dsBan = await TKB.find(query).select('PhongHoc').lean();
        res.json(dsBan.map(item => item.PhongHoc.toString()));
    } catch (err) {
        res.status(500).json([]);
    }
});

// API tÃ¬m danh sÃ¡ch phÃ²ng há»c Ä‘ang trá»‘ng
router.get('/api/room-status', async (req, res) => {
    try {
        const user = req.session.user;
        if (!user || user.QuyenHan === 'sinhvien') {
            return res.status(403).json({ message: 'Khong co quyen kiem tra phong dang ky.' });
        }

        const { tuan, thu, tietBD, tietKT, lopHocID } = req.query;

        if (!tuan || !thu || !tietBD || !tietKT || !lopHocID) {
            return res.status(400).json({ message: 'Thieu tham so truy van.' });
        }

        const ngayHoc = await tinhNgayHoc(parseInt(tuan, 10), thu, lopHocID);
        const [busyTKB, allRooms, lop] = await Promise.all([
            TKB.find({
                Tuan: parseInt(tuan, 10),
                Thu: thu,
                NgayHoc: ngayHoc,
                TrangThai: 'da-duyet',
                ...timeOverlap(parseInt(tietBD, 10), parseInt(tietKT, 10))
            }).distinct('PhongHoc'),
            PhongHoc.find().sort({ TenPhong: 1 }).select('TenPhong LoaiPhong SucChua KhoaThuCong').lean(),
            LopHoc.findById(lopHocID).select('TenLop SiSo').lean()
        ]);

        const busyRoomIds = new Set(busyTKB.map(function (id) {
            return id.toString();
        }));
        const rooms = allRooms.map(function (phong) {
            return taoTrangThaiPhong(phong, busyRoomIds, lop, ngayHoc);
        });

        res.json({
            ngayHoc: ngayHoc,
            ngayHocHienThi: new Date(ngayHoc).toLocaleDateString('vi-VN'),
            isPast: laNgayDaQua(ngayHoc),
            siSo: lop ? (lop.SiSo || 0) : 0,
            rooms: rooms,
            availableRooms: rooms.filter(function (room) { return room.available; })
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Loi may chu khi kiem tra phong.' });
    }
});

router.get('/api/check-available-rooms', async (req, res) => {
    try {
        const { tuan, thu, tietBD, tietKT, lopHocID } = req.query;

        if (!tuan || !thu || !tietBD || !tietKT || !lopHocID) {
            return res.status(400).json({ message: "Thiáº¿u tham sá»‘ truy váº¥n" });
        }

        // BÆ°á»›c 1 & 2: TÃ¬m ngÃ y há»c vÃ  cÃ¡c lá»‹ch báº­n giao thoa tiáº¿t há»c
        const ngayHoc = await tinhNgayHoc(parseInt(tuan), thu, lopHocID);
        const busyTKB = await TKB.find({
            Tuan: parseInt(tuan),
            Thu: thu,
            NgayHoc: ngayHoc,
            TrangThai: 'da-duyet',
            ...timeOverlap(parseInt(tietBD), parseInt(tietKT))
        }).distinct('PhongHoc'); // BÆ°á»›c 3: Láº¥y danh sÃ¡ch ID phÃ²ng bá»‹ chiáº¿m

        // BÆ°á»›c 4: Láº¥y phÃ²ng khÃ´ng náº±m trong danh sÃ¡ch báº­n vÃ  khÃ´ng báº£o trÃ¬
        const availableRooms = await PhongHoc.find({
            _id: { $nin: busyTKB },
            KhoaThuCong: false
        }).select('TenPhong LoaiPhong SucChua');

        res.json(availableRooms);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lá»—i mÃ¡y chá»§ khi kiá»ƒm tra phÃ²ng" });
    }
});

router.post('/yeu-cau-huy/:id', async (req, res) => {
    try {
        const user = req.session.user;
        if (!user) return res.redirect('/auth/dangnhap');
        if (user.QuyenHan !== 'giangvien') {
            req.session.error = 'Chỉ giảng viên mới được gửi yêu cầu hủy/nghỉ lịch.';
            return res.redirect('/tkb');
        }

        const lich = await TKB.findById(req.params.id)
            .populate('MonHoc LopHoc PhongHoc GiangVien');
        if (!lich) {
            req.session.error = 'Không tìm thấy lịch cần yêu cầu hủy.';
            return res.redirect('/tkb');
        }
        if (String(lich.GiangVien._id || lich.GiangVien) !== String(user._id)) {
            req.session.error = 'Bạn chỉ được yêu cầu hủy lịch của chính mình.';
            return res.redirect('/tkb');
        }
        if (lich.TrangThai !== 'da-duyet') {
            req.session.error = 'Chỉ lịch đã duyệt mới được gửi yêu cầu hủy/nghỉ.';
            return res.redirect('/tkb');
        }
        if (lich.NgayHoc && laNgayDaQua(lich.NgayHoc)) {
            req.session.error = 'Không thể yêu cầu hủy lịch đã qua ngày.';
            return res.redirect('/tkb');
        }
        if (lich.HuyTrangThai === 'cho-duyet') {
            req.session.error = 'Lịch này đã có yêu cầu hủy đang chờ admin duyệt.';
            return res.redirect('/tkb');
        }

        const lyDo = String(req.body.LyDoHuy || '').trim();
        await TKB.findByIdAndUpdate(req.params.id, {
            HuyTrangThai: 'cho-duyet',
            LyDoHuy: lyDo,
            NgayYeuCauHuy: new Date(),
            NgayDuyetHuy: null
        });

        await taoThongBaoChoAdmin(
            'Giảng viên yêu cầu hủy/nghỉ lịch',
            user.HoVaTen + ' yêu cầu hủy lịch ' +
            (lich.MonHoc ? lich.MonHoc.TenMonHoc : 'môn học') + ' - ' +
            (lich.LopHoc ? lich.LopHoc.TenLop : 'lớp học') + ', ' +
            lich.Thu + ', tiết ' + lich.TietBatDau + '-' + lich.TietKetThuc +
            (lyDo ? '. Lý do: ' + lyDo : '.'),
            '/tkb/danhsach?tuan=' + lich.Tuan
        );

        req.session.success = 'Đã gửi yêu cầu hủy/nghỉ lịch cho admin duyệt.';
        res.redirect('/tkb');
    } catch (err) {
        console.error(err);
        req.session.error = 'Không gửi được yêu cầu hủy lịch: ' + err.message;
        res.redirect('/tkb');
    }
});

router.use(requireAdmin);

router.post('/duyet-huy/:id', async (req, res) => {
    try {
        const lich = await TKB.findById(req.params.id).populate('MonHoc LopHoc PhongHoc GiangVien');
        if (!lich || lich.HuyTrangThai !== 'cho-duyet') {
            return res.json({ success: false, message: 'Không tìm thấy yêu cầu hủy đang chờ duyệt.' });
        }

        await taoThongBaoDatabaseKhiXoa(lich);
        await guiThongBaoLichHoc('huy-lich', lich);
        await TKB.findByIdAndDelete(req.params.id);

        await ThongBao.create({
            IDNguoiNhan: lich.GiangVien._id || lich.GiangVien,
            TieuDe: 'Yêu cầu hủy lịch đã được duyệt',
            NoiDung: 'Admin đã duyệt yêu cầu hủy lịch ' + (lich.MonHoc ? lich.MonHoc.TenMonHoc : 'môn học') + '.',
            LoaiThongBao: 'nghi-day',
            LienKet: '/tkb'
        });

        res.json({ success: true, message: 'Đã duyệt yêu cầu hủy và xóa lịch.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi duyệt yêu cầu hủy: ' + err.message });
    }
});

router.post('/tu-choi-huy/:id', async (req, res) => {
    try {
        const lich = await TKB.findByIdAndUpdate(req.params.id, {
            HuyTrangThai: 'tu-choi',
            NgayDuyetHuy: new Date()
        }).populate('MonHoc GiangVien');

        if (!lich) {
            return res.json({ success: false, message: 'Không tìm thấy yêu cầu hủy.' });
        }

        await ThongBao.create({
            IDNguoiNhan: lich.GiangVien._id || lich.GiangVien,
            TieuDe: 'Yêu cầu hủy lịch bị từ chối',
            NoiDung: 'Admin đã từ chối yêu cầu hủy lịch ' + (lich.MonHoc ? lich.MonHoc.TenMonHoc : 'môn học') + '.',
            LoaiThongBao: 'nghi-day',
            LienKet: '/tkb'
        });

        res.json({ success: true, message: 'Đã từ chối yêu cầu hủy.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Lỗi từ chối yêu cầu hủy: ' + err.message });
    }
});

router.post('/xep-tu-dong', async (req, res) => {
    req.session.error = 'Chá»©c nÄƒng nÃ y Ä‘Ã£ Ä‘á»•i sang tá»± Ä‘á»™ng phÃ¢n bá»• theo tá»•ng sá»‘ tiáº¿t cá»§a mÃ´n. Báº¡n hÃ£y vÃ o trang táº¡o thá»i khÃ³a biá»ƒu Ä‘á»ƒ há»‡ thá»‘ng sinh Ä‘á»§ cÃ¡c buá»•i há»c cho mÃ´n.';
    res.redirect('/tkb/them');
});

router.get('/danhsach', async (req, res) => {
    try {
        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);

        // Lá»c danh sÃ¡ch Ä‘Äƒng kÃ½ theo tuáº§n Ä‘Æ°á»£c chá»n
        const dsLich = await TKB.find({ Tuan: currentWeek })
            .populate('MonHoc')
            .populate('GiangVien')
            .populate('LopHoc')
            .populate('PhongHoc')
            .sort({ NgayDangKy: -1 });

        res.render('tkb_danhsach', {
            title: 'Quáº£n lÃ½ danh sÃ¡ch Ä‘Äƒng kÃ½',
            dstkb: dsLich,
            weeks,
            currentWeek,
            realCurrentWeek
        });
    } catch (err) {
        res.status(500).send("Lá»—i rá»“i!");
    }
});

// Trong hÃ m render trang danh sÃ¡ch lá»‹ch há»c
router.get('/danhsachcho', async (req, res) => {
    try {
        // Chá»‰ láº¥y nhá»¯ng cÃ¡i ÄANG CHá»œ Ä‘á»ƒ duyá»‡t
        const ds = await TKB.find({ TrangThai: 'cho-duyet' })
            .populate('MonHoc LopHoc GiangVien PhongHoc');
        res.render('tkb_duyet', { dstkb: ds, title: 'PhÃª duyá»‡t lá»‹ch há»c' });
    } catch (err) {
        res.status(500).send("Lá»—i: " + err);
    }
});

// Route xá»­ lÃ½ duyá»‡t lá»‹ch há»c
router.post('/da-duyet/:id', requireAdmin, async (req, res) => {
    // âš ï¸ FIX: Sá»­ dá»¥ng transaction Ä‘á»ƒ trÃ¡nh race condition khi duyá»‡t
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. TÃ¬m thÃ´ng tin cÃ¡i lá»‹ch Ä‘ang Ä‘á»‹nh duyá»‡t (populate Ä‘á»ƒ táº¡o ná»™i dung thÃ´ng bÃ¡o)
        const lichSapDuyet = await TKB.findById(req.params.id).populate('MonHoc LopHoc').session(session);

        if (!lichSapDuyet) {
            await session.abortTransaction();
            return res.status(404).json({ success: false, message: 'KhÃ´ng tÃ¬m tháº¥y lá»‹ch chá» duyá»‡t.' });
        }

        // âš ï¸ FIX: Náº¿u Ä‘Ã£ duyá»‡t rá»“i, khÃ´ng duyá»‡t láº¡i
        if (lichSapDuyet.TrangThai === 'da-duyet') {
            await session.abortTransaction();
            return res.json({ success: false, message: "Lá»‹ch nÃ y Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t trÆ°á»›c Ä‘Ã³ rá»“i." });
        }
        const ngayHocDuyet = lichSapDuyet.NgayHoc || await tinhNgayHoc(lichSapDuyet.Tuan, lichSapDuyet.Thu, lichSapDuyet.LopHoc._id);
        if (laNgayDaQua(ngayHocDuyet)) {
            await session.abortTransaction();
            return res.json({ success: false, message: 'KhÃ´ng thá»ƒ duyá»‡t lá»‹ch cho tuáº§n cÅ© hoáº·c ngÃ y Ä‘Ã£ qua.' });
        }
        await kiemTraPhongDangHoatDong(lichSapDuyet.PhongHoc, session);
        await kiemTraMonHocCuaLop(lichSapDuyet.LopHoc._id, lichSapDuyet.MonHoc._id, session);

        // 2. Kiá»ƒm tra xem cÃ³ lá»‹ch nÃ o KHÃC Ä‘Ã£ Ä‘Æ°á»£c duyá»‡t mÃ  trÃ¹ng Thá»©, Tiáº¿t, PhÃ²ng khÃ´ng
        // âš ï¸ FIX: Re-check xung Ä‘á»™t BÃŠN TRONG transaction
        const trungLich = await TKB.findOne({
            _id: { $ne: req.params.id },
            TrangThai: 'da-duyet',
            Thu: lichSapDuyet.Thu,
            Tuan: lichSapDuyet.Tuan,
            NgayHoc: ngayHocDuyet,
            PhongHoc: lichSapDuyet.PhongHoc,
            $or: [
                { TietBatDau: { $lte: lichSapDuyet.TietKetThuc }, TietKetThuc: { $gte: lichSapDuyet.TietBatDau } }
            ]
        }).session(session);

        if (trungLich) {
            await session.abortTransaction();
            return res.json({ success: false, message: "PhÃ²ng nÃ y Ä‘Ã£ cÃ³ lá»‹ch há»c vÃ o thá»i gian nÃ y rá»“i." });
        }

        // âš ï¸ FIX: Kiá»ƒm tra giáº£ng viÃªn cÅ©ng khÃ´ng Ä‘Æ°á»£c dáº¡y 2 lá»›p cÃ¹ng lÃºc
        const gvConflict = await TKB.findOne({
            _id: { $ne: req.params.id },
            TrangThai: 'da-duyet',
            GiangVien: lichSapDuyet.GiangVien,
            Thu: lichSapDuyet.Thu,
            Tuan: lichSapDuyet.Tuan,
            NgayHoc: ngayHocDuyet,
            $or: [
                { TietBatDau: { $lte: lichSapDuyet.TietKetThuc }, TietKetThuc: { $gte: lichSapDuyet.TietBatDau } }
            ]
        }).session(session);

        if (gvConflict) {
            await session.abortTransaction();
            return res.json({ success: false, message: "Giáº£ng viÃªn nÃ y Ä‘Ã£ cÃ³ lá»‹ch khÃ¡c vÃ o thá»i gian nÃ y rá»“i." });
        }

        // 3. Cáº­p nháº­t tráº¡ng thÃ¡i BÃŠN TRONG transaction
        await TKB.findByIdAndUpdate(req.params.id, {
            TrangThai: 'da-duyet',
            NgayHoc: ngayHocDuyet,
            NgayDuyet: new Date()
        }, { session });

        await session.commitTransaction();

        // âš ï¸ NOTE: CÃ¡c thao tÃ¡c gá»­i thÃ´ng bÃ¡o (DB + Web Push) cÃ³ thá»ƒ náº±m ngoÃ i transaction
        // vÃ¬ chÃºng khÃ´ng áº£nh hÆ°á»Ÿng Ä‘áº¿n tÃ­nh toÃ n váº¹n dá»¯ liá»‡u lá»‹ch há»c

        const thongBaoGV = new ThongBao({
            IDNguoiNhan: lichSapDuyet.GiangVien,
            TieuDe: "Báº¡n cÃ³ lá»‹ch má»›i Ä‘Æ°á»£c duyá»‡t!",
            NoiDung: "MÃ´n " + (lichSapDuyet.MonHoc ? lichSapDuyet.MonHoc.TenMonHoc : 'MÃ´n há»c') + " lá»›p " + (lichSapDuyet.LopHoc ? lichSapDuyet.LopHoc.TenLop : 'Lá»›p há»c') + " Ä‘Ã£ sáºµn sÃ ng.",
            LienKet: "/tkb"
        });
        await thongBaoGV.save();

        // B. Gá»­i thÃ´ng bÃ¡o trong Database (in-app) cho tá»«ng Sinh viÃªn trong lá»›p
        const dsSinhVien = await SinhVien.find({ IDLop: lichSapDuyet.LopHoc._id });
        if (dsSinhVien && dsSinhVien.length > 0) {
            for (let i = 0; i < dsSinhVien.length; i++) {
                const thongBaoSV = new ThongBao({
                    IDNguoiNhan: dsSinhVien[i].IDTaiKhoan,
                    TieuDe: "ThÃ´ng bÃ¡o: Lá»‹ch há»c má»›i",
                    NoiDung: "Lá»›p báº¡n vá»«a cÃ³ lá»‹ch má»›i cho mÃ´n " + (lichSapDuyet.MonHoc ? lichSapDuyet.MonHoc.TenMonHoc : 'MÃ´n há»c'),
                    LienKet: "/tkb"
                });
                await thongBaoSV.save();
            }
        }

        // C. Gá»­i Web Push Notification (Logic tá»« nhÃ¡nh Incoming)
        await guiThongBaoLichHoc('duyet-moi', req.params.id);

        res.json({ success: true, message: "ÄÃ£ duyá»‡t thÃ nh cÃ´ng vÃ  gá»­i thÃ´ng bÃ¡o cho má»i ngÆ°á»i!" });
    } catch (err) {
        await session.abortTransaction();
        console.error(err);
        res.status(500).json({ success: false, message: "Lá»—i : " + err.message });
    } finally {
        await session.endSession();
    }
});

// Route xá»­ lÃ½ Tá»ª CHá»I duyá»‡t lá»‹ch há»c
router.post('/tu-choi/:id', requireAdmin, async (req, res) => {
    // âš ï¸ FIX: Sá»­ dá»¥ng transaction Ä‘á»ƒ Ä‘áº£m báº£o consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Chá»‰ cáº­p nháº­t tráº¡ng thÃ¡i thÃ nh 'tu-choi' BÃŠN TRONG transaction
        const lichBiTuChoi = await TKB.findByIdAndUpdate(req.params.id, {
            TrangThai: 'tu-choi'
        }, { session });

        if (!lichBiTuChoi) {
            await session.abortTransaction();
            return res.json({ success: false, message: 'KhÃ´ng tÃ¬m tháº¥y lá»‹ch nÃ y.' });
        }

        // âš ï¸ FIX: Giáº£i phÃ³ng tráº¡ng thÃ¡i phÃ²ng há»c vá» 1 (Sáºµn sÃ ng) cÅ©ng trong transaction
        await session.commitTransaction();

        // âš ï¸ NOTE: Gá»­i thÃ´ng bÃ¡o cÃ³ thá»ƒ ngoÃ i transaction vÃ¬ khÃ´ng áº£nh hÆ°á»Ÿng Ä‘áº¿n dá»¯ liá»‡u chÃ­nh

        // 2. Gá»­i thÃ´ng bÃ¡o Database cho Giáº£ng viÃªn Ä‘á»ƒ há» biáº¿t vÃ  Ä‘Äƒng kÃ½ láº¡i
        const thongBaoReject = new ThongBao({
            IDNguoiNhan: lichBiTuChoi.GiangVien,
            TieuDe: "Lá»‹ch Ä‘Äƒng kÃ½ khÃ´ng Ä‘Æ°á»£c duyá»‡t",
            NoiDung: `Lá»‹ch Ä‘Äƒng kÃ½ mÃ´n há»c cá»§a báº¡n Ä‘Ã£ bá»‹ tá»« chá»‘i. Vui lÃ²ng kiá»ƒm tra láº¡i sÆ¡ Ä‘á»“ phÃ²ng há»c vÃ  Ä‘Äƒng kÃ½ khung giá» khÃ¡c nhÃ©.`,
            LienKet: "/tkb/dangky"
        });
        await thongBaoReject.save();

        res.json({ success: true, message: "ÄÃ£ tá»« chá»‘i vÃ  giáº£i phÃ³ng phÃ²ng há»c!" });
    } catch (err) {
        await session.abortTransaction();
        console.error(err);
        res.status(500).json({ success: false, message: "Lá»—i rá»“i: " + err.message });
    } finally {
        await session.endSession();
    }
});

router.get('/tkb-admin', requireAdmin, async (req, res) => {
    try {
        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);
        // 1. Láº¥y nguyÃªn liá»‡u: Táº¥t cáº£ phÃ²ng vÃ  lá»‹ch Ä‘Ã£ duyá»‡t
        const [dsphong, dsLich] = await Promise.all([
            PhongHoc.find().sort({ TenPhong: 1 }),
            TKB.find({ TrangThai: 'da-duyet', Tuan: currentWeek })
                .populate('MonHoc GiangVien LopHoc PhongHoc')
        ]);

        const cacThu = ['Thá»© 2', 'Thá»© 3', 'Thá»© 4', 'Thá»© 5', 'Thá»© 6', 'Thá»© 7', 'Chá»§ Nháº­t'];
        const cacBuoi = ['SÃ¡ng', 'Chiá»u', 'Tá»‘i'];

        res.render('tkb', {
            title: 'Há»‡ thá»‘ng Quáº£n lÃ½ Tá»•ng quÃ¡t - Edu KT',
            dsphong,
            dsTKB: dsLich,
            currentWeek,
            weeks,
            realCurrentWeek,
            cacThu,
            cacBuoi,
            user: req.session.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lá»—i táº£i trang tkb-admin rá»“i TÃ¢m áº¡!");
    }
});

router.get('/export-dangky', requireAdmin, async (req, res) => {
    try {
        // Láº¥y táº¥t cáº£ lá»‹ch Ä‘Äƒng kÃ½, Æ°u tiÃªn nhá»¯ng cÃ¡i má»›i nháº¥t lÃªn Ä‘áº§u Ä‘á»ƒ xem ngÃ y giá» cho dá»…
        const dsLich = await TKB.find()
            .populate('MonHoc')
            .populate('GiangVien')
            .populate('LopHoc')
            .populate('PhongHoc')
            .sort({ NgayDangKy: -1 })
            .lean();

        const rows = dsLich.map((item, index) => ({
            'STT': index + 1,
            'NgÃ y giá» Ä‘Äƒng kÃ½': item.NgayDangKy ? new Date(item.NgayDangKy).toLocaleString('vi-VN') : 'KhÃ´ng rÃµ',
            'MÃ´n há»c': item.MonHoc ? item.MonHoc.TenMonHoc : 'N/A',
            'Giáº£ng viÃªn': item.GiangVien ? item.GiangVien.HoVaTen : 'N/A',
            'Lá»›p há»c': item.LopHoc ? item.LopHoc.TenLop : 'N/A',
            'PhÃ²ng há»c': item.PhongHoc ? item.PhongHoc.TenPhong : 'N/A',
            'NgÃ y há»c': item.NgayHoc ? new Date(item.NgayHoc).toLocaleDateString('vi-VN') : 'KhÃ´ng rÃµ',
            'Thá»©': item.Thu,
            'Tiáº¿t há»c': `${item.TietBatDau} - ${item.TietKetThuc}`,
            'NgÃ y duyá»‡t': item.NgayDuyet ? new Date(item.NgayDuyet).toLocaleString('vi-VN') : '',
            'Tráº¡ng thÃ¡i': item.TrangThai === 'cho-duyet' ? 'Chá» duyá»‡t' : (item.TrangThai === 'da-duyet' ? 'ÄÃ£ duyá»‡t' : 'Tá»« chá»‘i')
        }));

        const workbook = buildWorkbook('DanhSachDangKy', rows);
        const fileName = `bao-cao-dang-ky-tkb-${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.xlsx`;
        sendWorkbook(res, workbook, fileName);
    } catch (err) {
        console.error(err);
        res.status(500).send("Lá»—i xuáº¥t Excel: " + err.message);
    }
});

module.exports = router;
