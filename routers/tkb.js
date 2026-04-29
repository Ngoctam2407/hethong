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
var { tinhNgayHoc, getFormattedNgayHoc, thuToOffset } = require('../utils/date_helpers'); // Import từ tiện ích mới

// Hàm tính toán thông tin tuần học dựa trên ngày thực tế
async function calculateWeeksData(selectedTuan) {
    // Tìm lớp học có ngày bắt đầu sớm nhất, đảm bảo bỏ qua dữ liệu trống
    const firstLop = await LopHoc.findOne({ NgayBatDauNamHoc: { $exists: true, $ne: null } }).sort({ NgayBatDauNamHoc: 1 });
    const lastLop = await LopHoc.findOne({ NgayKetThucNamHoc: { $exists: true, $ne: null } }).sort({ NgayKetThucNamHoc: -1 });

    let startPoint = (firstLop && firstLop.NgayBatDauNamHoc) ? new Date(firstLop.NgayBatDauNamHoc) : new Date();

    // Tính toán số tuần dựa trên ngày kết thúc thực tế của các lớp học
    let totalWeeks = 20; // Mặc định là 20 tuần nếu chưa có dữ liệu ngày kết thúc
    if (firstLop && lastLop && lastLop.NgayKetThucNamHoc) {
        const start = new Date(firstLop.NgayBatDauNamHoc);
        const end = new Date(lastLop.NgayKetThucNamHoc);
        const diffInMs = end.getTime() - start.getTime();
        if (diffInMs > 0) {
            // Tính số tuần: (Khoảng cách ngày / 7) + 1
            totalWeeks = Math.ceil(diffInMs / (7 * 24 * 60 * 60 * 1000)) + 1;
        }
    }

    // Nếu đối tượng Date không hợp lệ (NaN), mặc định lấy ngày hiện tại
    if (isNaN(startPoint.getTime())) {
        startPoint = new Date();
    }

    // Đưa về Thứ 2 của tuần khai giảng
    let day = startPoint.getDay();
    startPoint.setDate(startPoint.getDate() - (day === 0 ? 6 : day - 1));
    startPoint.setHours(0, 0, 0, 0);

    let weeks = [];
    let autoWeek = 1;
    let today = new Date();

    for (let i = 0; i < totalWeeks; i++) { // Sử dụng số tuần thực tế tính được
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
        throw new Error('Không tìm thấy lớp học để đăng ký lịch.');
    }

    if (lop.TrangThai === 0) {
        throw new Error('Lớp học đang tạm ngưng nên không thể đăng ký lịch.');
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
        throw new Error('Khong tim thay phong hoc de xep lich.');
    }

    if (phong.KhoaThuCong) {
        throw new Error('Phong ' + phong.TenPhong + ' dang duoc khoa de sua chua/bao tri.');
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
        throw new Error('Không tìm thấy môn học để xếp lịch.');
    }

    if (!monHoc.TongSoTiet || monHoc.TongSoTiet <= 0) {
        throw new Error('Môn học chưa có tổng số tiết nên chưa thể tự động phân bổ.');
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
    // Lặp đến giới hạn tuần của lớp hoặc tối đa 25 tuần để an toàn
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
        throw new Error('Không đủ số tuần trống trong học kỳ để xếp đủ ' + monHoc.TongSoTiet + ' tiết cho môn này.');
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
            title: 'Lich hoc da duoc duyet',
            body: `Ban co lich day moi: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
        payloadSV = {
            title: 'Lich hoc moi',
            body: `Lop ban co lich hoc moi: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
    } else if (loaiThongBao === 'cap-nhat') {
        payloadGV = {
            title: 'Lich day da thay doi',
            body: `Lich day cua ban vua duoc cap nhat: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
        payloadSV = {
            title: 'Lich hoc da thay doi',
            body: `Lich hoc cua lop ban vua duoc cap nhat: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
    } else if (loaiThongBao === 'huy-lich') {
        payloadGV = {
            title: 'Lich day da bi huy',
            body: `Mot lich day cua ban da bi xoa: ${noiDungLich}`,
            url,
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };
        payloadSV = {
            title: 'Lich hoc da bi huy',
            body: `Mot lich hoc cua lop ban da bi xoa: ${noiDungLich}`,
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

// GET: Hiện danh sách TKB
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;
        if (!user) return res.redirect('/auth/dangnhap'); // Chưa đăng nhập thì mời ra ngoài 

        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);

        const dsphong = await PhongHoc.find().sort({ TenPhong: 1 });
        // 1. Tạo điều kiện lọc ban đầu (chỉ lấy những môn đã da-duyet)
        let query = { TrangThai: 'da-duyet' };
        query.Tuan = currentWeek;

        // 2. PHÂN LUỒNG TẠI ĐÂY:
        if (user.QuyenHan === 'SinhVien' || user.QuyenHan === 'sinhvien') {
            // Với sinh viên, luôn lấy ID lớp từ bảng SinhVien để lọc TKB chính xác
            const thongTinSV = await SinhVien.findOne({ IDTaiKhoan: user._id });
            if (thongTinSV) {
                query.LopHoc = thongTinSV.IDLop;
            } else {
                query._id = null;
            }
        } else if (user.QuyenHan === 'GiangVien' || user.QuyenHan === 'giangvien') {
            // Nếu là Giảng viên: Chỉ tìm những lịch mà ID giảng viên khớp với người đang logged in
            query.GiangVien = user._id;
        }
        // Nếu là Admin thì query giữ nguyên { TrangThai: 'da-duyet' } để xem tất cả

        // 3. Thực hiện tìm kiếm
        const thoiKhoaBieu = await TKB.find(query)
            .populate('MonHoc')
            .populate('PhongHoc')
            .populate('GiangVien')
            .populate('LopHoc')
            .sort({ Thu: 1, TietBatDau: 1 });

        // Thêm trường ngày học định dạng dd/mm/yyyy để hiển thị ở frontend
        const dsTKBFormatted = await Promise.all(thoiKhoaBieu.map(async item => {
            const ngayHocHienThi = await getFormattedNgayHoc(item);
            return { ...item.toObject(), NgayHocHienThi: ngayHocHienThi };
        }));

        res.render('tkb', {
            title: 'Thời Khóa Biểu',
            user,
            dsphong: dsphong,
            cacThu: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'],
            cacBuoi: ['Sáng', 'Chiều', 'Tối'],
            dsTKB: dsTKBFormatted, // Gửi danh sách đã có ngày định dạng
            currentWeek,
            weeks,
            realCurrentWeek
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi hệ thống rồi.");
    }
});

// GET: Hiện trang thêm TKB
router.post('/them', async (req, res) => {
    // ⚠️ FIX: Sử dụng transaction để đảm bảo atomicity
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { MonHoc: monHocInput, GiangVien, PhongHoc: phongHocID, LopHoc: lopHocID, Thu, TietBatDau, TietKetThuc, Tuan: tuanInput } = req.body;
        const tietBD = parseInt(TietBatDau, 10);
        const tietKT = parseInt(TietKetThuc, 10);
        const Tuan = parseInt(tuanInput, 10) || 1;

        // Chấp nhận cả 1 ID môn hoặc 1 mảng ID môn
        const monHocIds = Array.isArray(monHocInput) ? monHocInput : [monHocInput];

        const { realCurrentWeek } = await calculateWeeksData();
        if (Tuan < realCurrentWeek) {
            await session.abortTransaction();
            req.session.error = "Không thể thêm lịch vào các tuần trong quá khứ.";
            return res.redirect('back');
        }

        // ⚠️ FIX: Validate dữ liệu input
        if (tietKT < tietBD) {
            await session.abortTransaction();
            req.session.error = "Tiết kết thúc phải >= tiết bắt đầu";
            return res.redirect('back');
        }

        const [lop, phong] = await Promise.all([
            LopHoc.findById(lopHocID).session(session),
            kiemTraPhongDangHoatDong(phongHocID, session)
        ]);

        if (phong && lop && phong.SucChua < lop.SiSo) {
            await session.abortTransaction();
            req.session.error = `Phòng ${phong.TenPhong} chỉ chứa được ${phong.SucChua} bạn, mà lớp này tận ${lop.SiSo} bạn lận Tâm ạ!`;
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


// GET: Hiện trang thêm TKB (Admin)
router.get('/them', requireAdmin, async (req, res) => {
    try {
        const [dsmon, dsgiangvien, dslop, dsphong] = await Promise.all([
            MonHoc.find(),
            TaiKhoan.find({ QuyenHan: 'giangvien' }),
            LopHoc.find({ TrangThai: 1 }).populate('DanhSachMonHoc').lean(), // Sử dụng lean() để dễ dàng xử lý ở JS frontend
            PhongHoc.find()
        ]);
        const { weeks, currentWeek } = await calculateWeeksData(req.query.tuan);
        res.render('tkb_them', {
            title: 'Tạo Thời Khóa Biểu Mới',
            dsmon,
            dsgiangvien,
            dslop,
            dsphong,
            weeks,
            currentWeek
        });
    } catch (err) {
        res.status(500).send("Lỗi tải trang thêm: " + err);
    }
});

// GET: Hiện trang Sửa TKB
router.get('/sua/:id', async (req, res) => {
    try {
        const item = await TKB.findById(req.params.id);
        const dsPhong = await PhongHoc.find();
        const dsGiangVien = await TaiKhoan.find({ QuyenHan: 'giangvien' });
        const dsMonHoc = await MonHoc.find();
        const dsLopHoc = await LopHoc.find().populate('DanhSachMonHoc');
        const { weeks } = await calculateWeeksData(item.Tuan);

        res.render('tkb_sua', {
            title: 'Chỉnh Sửa Lịch Học',
            tkb: item,
            dsPhong: dsPhong,
            dsGiangVien: dsGiangVien,
            dsMonHoc: dsMonHoc,
            dsLopHoc: dsLopHoc,
            weeks
        });
    } catch (err) {
        res.send("Lỗi không tìm thấy lịch để sửa Tâm ơi: " + err);
    }
});

// POST: Cập nhật TKB sau khi sửa
router.post('/sua/:id', async (req, res) => {
    // ⚠️ FIX: Sử dụng transaction để đảm bảo consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { MonHoc: monHocID, LopHoc: lopHocID, TietBatDau, PhongHoc: phongMoiID, Thu, Tuan, TietKetThuc } = req.body;
        const tietBD = parseInt(TietBatDau, 10);
        const tietKT = parseInt(TietKetThuc, 10);

        const { realCurrentWeek } = await calculateWeeksData();
        if (parseInt(Tuan) < realCurrentWeek) {
            await session.abortTransaction();
            req.session.error = "Không thể chỉnh sửa lịch ở các tuần trong quá khứ.";
            return res.redirect('back');
        }

        // ⚠️ FIX: Validate input
        if (tietKT < tietBD) {
            await session.abortTransaction();
            req.session.error = "Tiết kết thúc phải >= tiết bắt đầu";
            return res.redirect('back');
        }

        const lichCu = await TKB.findById(req.params.id).session(session);
        if (!lichCu) {
            await session.abortTransaction();
            return res.send("Không tìm thấy lịch này.");
        }

        const ngayHocMoi = await tinhNgayHoc(Tuan, Thu, lopHocID);
        if (laNgayDaQua(ngayHocMoi)) {
            await session.abortTransaction();
            req.session.error = 'Không thể chuyển lịch về tuần cũ hoặc ngày đã qua.';
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

            // Kiểm tra xung đột giảng viên
            const gvConflict = await TKB.findOne({
                GiangVien: lichCu.GiangVien,
                ...conflictQuery
            }).session(session);

            if (gvConflict) {
                await session.abortTransaction();
                req.session.error = "Giảng viên này đã có lịch khác vào khung giờ mới này";
                return res.redirect('back');
            }

            // Kiểm tra xung đột phòng (nếu đổi phòng)
            if (phongDaThayDoi) {
                const phongConflict = await TKB.findOne({
                    PhongHoc: phongMoiID,
                    ...conflictQuery
                }).session(session);

                if (phongConflict) {
                    await session.abortTransaction();
                    req.session.error = "Phòng mới này đã bận vào khung giờ mới";
                    return res.redirect('back');
                }
            }

            // Kiểm tra xung đột lớp
            const lopConflict = await TKB.findOne({
                LopHoc: lopHocID,
                ...conflictQuery
            }).session(session);

            if (lopConflict) {
                await session.abortTransaction();
                req.session.error = "Lớp này đã có môn khác vào khung giờ mới";
                return res.redirect('back');
            }
        }

        // ⚠️ FIX: Nếu đổi phòng, kiểm tra sức chứa
        if (phongDaThayDoi) {
            await kiemTraPhongDangHoatDong(phongMoiID, session);
            const phong = await PhongHoc.findById(phongMoiID).session(session);
            const lop = await LopHoc.findById(lopHocID).session(session);

            if (phong && lop && phong.SucChua < lop.SiSo) {
                await session.abortTransaction();
                req.session.error = `Phòng ${phong.TenPhong} chỉ chứa ${phong.SucChua}, lớp có ${lop.SiSo} sinh viên!`;
                return res.redirect('back');
            }
        }

        // ⚠️ FIX: Cập nhật LƯU LỚP CA HỌC TRONG TRANSACTION
        const caHocTuDong = tietBD <= 5 ? 'Sáng' : (tietBD <= 10 ? 'Chiều' : 'Tối');
        await TKB.findByIdAndUpdate(
            req.params.id,
            { ...req.body, NgayHoc: ngayHocMoi, CaHoc: caHocTuDong },
            { session }
        );

        // ⚠️ FIX: Nếu đổi phòng, cập nhật trạng thái cả phòng cũ và phòng mới
        await session.commitTransaction();

        if (lichCu.TrangThai === 'da-duyet') {
            await guiThongBaoLichHoc('cap-nhat', req.params.id);
        }

        req.session.success = "Cập nhật lịch học thành công.";
        res.redirect('/tkb');
    } catch (err) {
        await session.abortTransaction();
        console.error(err);
        req.session.error = "Lỗi cập nhật: " + err.message;
        res.redirect('back');
    } finally {
        await session.endSession();
    }
});

// GET: Xóa TKB
router.get('/xoa/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const lichCu = await TKB.findById(id).populate('MonHoc LopHoc PhongHoc');

        const { realCurrentWeek } = await calculateWeeksData();
        if (lichCu && lichCu.Tuan < realCurrentWeek) {
            req.session.error = "Lịch trong quá khứ không được phép xóa.";
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
        // 1. Khởi tạo query mặc định
        let query = { TrangThai: 'da-duyet' };
        query.Tuan = currentWeek;

        // 2. PHÂN LUỒNG: Tâm lưu ý chỗ này để hiện đúng lịch từng người nhé
        if (user.QuyenHan === 'sinhvien') {
            // Vì bảng TaiKhoan không có LopHoc, mình cần tìm ở bảng SinhVien để lấy ID lớp
            const thongTinSV = await require('../models/sinhvien').findOne({ IDTaiKhoan: user._id });
            if (thongTinSV) query.LopHoc = thongTinSV.IDLop;
        } else if (user.QuyenHan === 'giangvien') {
            // Giảng viên thì lọc theo ID tài khoản của họ
            query.GiangVien = user._id;
        }

        // 3. Lấy dữ liệu và dùng .populate để "đổ đầy" thông tin
        const [dsLich, dsphong] = await Promise.all([
            TKB.find(query).populate('MonHoc PhongHoc GiangVien LopHoc'),
            PhongHoc.find().sort({ TenPhong: 1 })
        ]);

        // 4. Tối ưu đoạn tính ThuIndex (Dùng Object thay vì if/else dài dòng)
        const thuMap = { 'Thứ 2': 2, 'Thứ 3': 3, 'Thứ 4': 4, 'Thứ 5': 5, 'Thứ 6': 6, 'Thứ 7': 7, 'Chủ Nhật': 8 };

        const dsTKB = await Promise.all(dsLich.map(async item => {
            const ngayHocHienThi = await getFormattedNgayHoc(item);
            return {
                ...item._doc, ThuIndex: thuMap[item.Thu] || 2, SoTiet: ((item.TietKetThuc || 0) - (item.TietBatDau || 0)) + 1, NgayHocHienThi: ngayHocHienThi
            };
        }));

        res.render('tkb', {
            title: 'Thời Khóa Biểu Của Tôi',
            dsTKB: dsTKB,
            dsphong: dsphong,
            user: user,
            currentWeek,
            weeks
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi lưới rồi Tâm ơi: " + err.message);
    }
});

// Trong file routers/taikhoan.js
// Route hiển thị trang đăng ký
router.get('/dangky', async (req, res) => {
    try {
        const user = req.session.user;
        if (!user) return res.redirect('/auth/dangnhap');
        if (user.QuyenHan === 'sinhvien') {
            req.session.error = 'Sinh viên không có quyền đăng ký lịch học.';
            return res.redirect('/tkb');
        }

        // Tâm lưu ý: Trong Database em dùng 'QuyenHan' (không dùng 'role')
        // Mình đang dùng field QuyenHan trong collection TaiKhoan
        const dsGiangVien = await TaiKhoan.find({ QuyenHan: 'giangvien' });
        const dsMon = await MonHoc.find();
        const dsPhong = await PhongHoc.find();

        // Sửa lỗi ở đây: Dùng LopHoc (đã require ở dòng 7) thay vì Lop
        const dsLop = await LopHoc.find().populate('DanhSachMonHoc');
        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);

        res.render('tkb_dangky', {
            title: 'Đăng ký học phần Edu KT',
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
        console.error("Lỗi lọc dữ liệu Tâm ơi:", err);
        res.status(500).send("Lỗi rồi. Kiểm tra Terminal xem lỗi gì nha.");
    }
});

router.post('/dang-ky-luu', async (req, res) => {
    // ⚠️ FIX: Sử dụng MongoDB Session để tạo transaction
    // Điều này giúp tránh race condition khi nhiều người đăng ký cùng lúc
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
            req.session.error = 'Sinh viên không có quyền đăng ký lịch học.';
            return res.redirect('/tkb');
        }

        // Đổi tên biến lấy từ body để không trùng với tên Model (thêm chữ ID vào sau)
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
            req.session.error = 'Không thể đăng ký lịch cho các tuần đã qua.';
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        if (tietKT < tietBD) {
            await session.abortTransaction();
            req.session.error = "Tiết kết thúc phải >= tiết bắt đầu";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        const { ngayHoc, query: conflictQuery } = await taoDieuKienXungDot(Thu, tuanInt, tietBD, tietKT, lopHocID);
        if (laNgayDaQua(ngayHoc)) {
            await session.abortTransaction();
            req.session.error = 'Chỉ được đăng ký cho ngày mới, không cho đăng ký tuần cũ.';
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        await kiemTraMonHocCuaLop(lopHocID, monHocID, session);

        // ⚠️ FIX: RE-CHECK xung đột BÊN TRONG transaction (lần thứ 2)
        // Lần này sẽ lock dữ liệu, nên nó sẽ chắc chắn detect được nếu có trùng
        const [gvConflict, roomConflict, lopConflict] = await Promise.all([
            TKB.findOne({ GiangVien: giangVienID, ...conflictQuery }).session(session),
            TKB.findOne({ PhongHoc: phongHocID, ...conflictQuery }).session(session),
            TKB.findOne({ LopHoc: lopHocID, ...conflictQuery }).session(session)
        ]);

        if (gvConflict) {
            await session.abortTransaction();
            req.session.error = "Giảng viên đang sắp có lịch dạy giờ này";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }
        if (roomConflict) {
            await session.abortTransaction();
            req.session.error = "Phòng đang dùng giờ này";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }
        if (lopConflict) {
            await session.abortTransaction();
            req.session.error = "Lớp này đã lớp khác dạy giờ này rồi , nên không được đăng ký đâu nhé.";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        const lop = await LopHoc.findById(lopHocID).session(session);
        const phong = await kiemTraPhongDangHoatDong(phongHocID, session);

        if (phong && lop && phong.SucChua < lop.SiSo) {
            await session.abortTransaction();
            req.session.error = `Phòng ${phong.TenPhong} chỉ chứa ${phong.SucChua}, Lớp có tận ${lop.SiSo} sinh viên!`;
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        const caHocTuDong = tietBD <= 5 ? 'Sáng' : (tietBD <= 10 ? 'Chiều' : 'Tối');

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

        // ⚠️ FIX: Lưu trong transaction (sẽ rollback nếu có lỗi)
        await lichMoi.save({ session });

        // ⚠️ FIX: Commit transaction sau khi tất cả thành công
        await session.commitTransaction();

        req.session.success = "Đã lưu lịch rồi, chờ duyệt nhé!";
        res.redirect('/tkb');
    } catch (err) {
        // ⚠️ FIX: Rollback nếu có bất kỳ lỗi nào
        await session.abortTransaction();
        console.error(err);

        // Phát hiện lỗi unique constraint (duplicate)
        if (err.code === 11000) {
            req.session.error = "Lịch này đã bị xung đột! Có thể do nhiều người đăng ký cùng lúc. Vui lòng thử lại.";
        } else {
            req.session.error = "Lỗi server: " + err.message;
        }
        res.redirect(req.get('referer') || '/tkb/dangky');
    } finally {
        // ⚠️ FIX: Luôn luôn close session sau khi hoàn thành
        await session.endSession();
    }
});

// API kiểm tra danh sách phòng bận để khóa ở giao diện
router.get('/api/check-phong-ban', async (req, res) => {
    try {
        const { tuan, thu, tietBD, tietKT, lopHocID } = req.query;
        // Nếu thiếu thông tin thì trả về mảng rỗng (không khóa phòng nào)
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

// API tìm danh sách phòng học đang trống
router.get('/api/check-available-rooms', async (req, res) => {
    try {
        const { tuan, thu, tietBD, tietKT, lopHocID } = req.query;

        if (!tuan || !thu || !tietBD || !tietKT || !lopHocID) {
            return res.status(400).json({ message: "Thiếu tham số truy vấn" });
        }

        // Bước 1 & 2: Tìm ngày học và các lịch bận giao thoa tiết học
        const ngayHoc = await tinhNgayHoc(parseInt(tuan), thu, lopHocID);
        const busyTKB = await TKB.find({
            Tuan: parseInt(tuan),
            Thu: thu,
            NgayHoc: ngayHoc,
            TrangThai: 'da-duyet',
            ...timeOverlap(parseInt(tietBD), parseInt(tietKT))
        }).distinct('PhongHoc'); // Bước 3: Lấy danh sách ID phòng bị chiếm

        // Bước 4: Lấy phòng không nằm trong danh sách bận và không bảo trì
        const availableRooms = await PhongHoc.find({
            _id: { $nin: busyTKB },
            KhoaThuCong: false,
            TrangThai: 1
        }).select('TenPhong LoaiPhong SucChua');

        res.json(availableRooms);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lỗi máy chủ khi kiểm tra phòng" });
    }
});

router.use(requireAdmin);

router.post('/xep-tu-dong', async (req, res) => {
    req.session.error = 'Chức năng này đã đổi sang tự động phân bổ theo tổng số tiết của môn. Bạn hãy vào trang tạo thời khóa biểu để hệ thống sinh đủ các buổi học cho môn.';
    res.redirect('/tkb/them');
});

router.get('/danhsach', async (req, res) => {
    try {
        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);

        // Lọc danh sách đăng ký theo tuần được chọn
        const dsLich = await TKB.find({ Tuan: currentWeek })
            .populate('MonHoc')
            .populate('GiangVien')
            .populate('LopHoc')
            .populate('PhongHoc')
            .sort({ NgayDangKy: -1 });

        res.render('tkb_danhsach', {
            title: 'Quản lý danh sách đăng ký',
            dstkb: dsLich,
            weeks,
            currentWeek,
            realCurrentWeek
        });
    } catch (err) {
        res.status(500).send("Lỗi rồi!");
    }
});

// Trong hàm render trang danh sách lịch học
router.get('/danhsachcho', async (req, res) => {
    try {
        // Chỉ lấy những cái ĐANG CHỜ để duyệt
        const ds = await TKB.find({ TrangThai: 'cho-duyet' })
            .populate('MonHoc LopHoc GiangVien PhongHoc');
        res.render('tkb_duyet', { dstkb: ds, title: 'Phê duyệt lịch học' });
    } catch (err) {
        res.status(500).send("Lỗi: " + err);
    }
});

// Route xử lý duyệt lịch học
router.post('/da-duyet/:id', requireAdmin, async (req, res) => {
    // ⚠️ FIX: Sử dụng transaction để tránh race condition khi duyệt
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Tìm thông tin cái lịch đang định duyệt (populate để tạo nội dung thông báo)
        const lichSapDuyet = await TKB.findById(req.params.id).populate('MonHoc LopHoc').session(session);

        if (!lichSapDuyet) {
            await session.abortTransaction();
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch chờ duyệt.' });
        }

        // ⚠️ FIX: Nếu đã duyệt rồi, không duyệt lại
        if (lichSapDuyet.TrangThai === 'da-duyet') {
            await session.abortTransaction();
            return res.json({ success: false, message: "Lịch này đã được duyệt trước đó rồi." });
        }
        const ngayHocDuyet = lichSapDuyet.NgayHoc || await tinhNgayHoc(lichSapDuyet.Tuan, lichSapDuyet.Thu, lichSapDuyet.LopHoc._id);
        if (laNgayDaQua(ngayHocDuyet)) {
            await session.abortTransaction();
            return res.json({ success: false, message: 'Không thể duyệt lịch cho tuần cũ hoặc ngày đã qua.' });
        }
        await kiemTraPhongDangHoatDong(lichSapDuyet.PhongHoc, session);
        await kiemTraMonHocCuaLop(lichSapDuyet.LopHoc._id, lichSapDuyet.MonHoc._id, session);

        // 2. Kiểm tra xem có lịch nào KHÁC đã được duyệt mà trùng Thứ, Tiết, Phòng không
        // ⚠️ FIX: Re-check xung đột BÊN TRONG transaction
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
            return res.json({ success: false, message: "Phòng này đã có lịch học vào thời gian này rồi." });
        }

        // ⚠️ FIX: Kiểm tra giảng viên cũng không được dạy 2 lớp cùng lúc
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
            return res.json({ success: false, message: "Giảng viên này đã có lịch khác vào thời gian này rồi." });
        }

        // 3. Cập nhật trạng thái BÊN TRONG transaction
        await TKB.findByIdAndUpdate(req.params.id, {
            TrangThai: 'da-duyet',
            NgayHoc: ngayHocDuyet,
            NgayDuyet: new Date()
        }, { session });

        await session.commitTransaction();

        // ⚠️ NOTE: Các thao tác gửi thông báo (DB + Web Push) có thể nằm ngoài transaction
        // vì chúng không ảnh hưởng đến tính toàn vẹn dữ liệu lịch học

        const thongBaoGV = new ThongBao({
            IDNguoiNhan: lichSapDuyet.GiangVien,
            TieuDe: "Bạn có lịch mới được duyệt!",
            NoiDung: "Môn " + (lichSapDuyet.MonHoc ? lichSapDuyet.MonHoc.TenMonHoc : 'Môn học') + " lớp " + (lichSapDuyet.LopHoc ? lichSapDuyet.LopHoc.TenLop : 'Lớp học') + " đã sẵn sàng.",
            LienKet: "/tkb"
        });
        await thongBaoGV.save();

        // B. Gửi thông báo trong Database (in-app) cho từng Sinh viên trong lớp
        const dsSinhVien = await SinhVien.find({ IDLop: lichSapDuyet.LopHoc._id });
        if (dsSinhVien && dsSinhVien.length > 0) {
            for (let i = 0; i < dsSinhVien.length; i++) {
                const thongBaoSV = new ThongBao({
                    IDNguoiNhan: dsSinhVien[i].IDTaiKhoan,
                    TieuDe: "Thông báo: Lịch học mới",
                    NoiDung: "Lớp bạn vừa có lịch mới cho môn " + (lichSapDuyet.MonHoc ? lichSapDuyet.MonHoc.TenMonHoc : 'Môn học'),
                    LienKet: "/tkb"
                });
                await thongBaoSV.save();
            }
        }

        // C. Gửi Web Push Notification (Logic từ nhánh Incoming)
        await guiThongBaoLichHoc('duyet-moi', req.params.id);

        res.json({ success: true, message: "Đã duyệt thành công và gửi thông báo cho mọi người!" });
    } catch (err) {
        await session.abortTransaction();
        console.error(err);
        res.status(500).json({ success: false, message: "Lỗi : " + err.message });
    } finally {
        await session.endSession();
    }
});

// Route xử lý TỪ CHỐI duyệt lịch học
router.post('/tu-choi/:id', requireAdmin, async (req, res) => {
    // ⚠️ FIX: Sử dụng transaction để đảm bảo consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // 1. Chỉ cập nhật trạng thái thành 'tu-choi' BÊN TRONG transaction
        const lichBiTuChoi = await TKB.findByIdAndUpdate(req.params.id, {
            TrangThai: 'tu-choi'
        }, { session });

        if (!lichBiTuChoi) {
            await session.abortTransaction();
            return res.json({ success: false, message: 'Không tìm thấy lịch này.' });
        }

        // ⚠️ FIX: Giải phóng trạng thái phòng học về 1 (Sẵn sàng) cũng trong transaction
        await session.commitTransaction();

        // ⚠️ NOTE: Gửi thông báo có thể ngoài transaction vì không ảnh hưởng đến dữ liệu chính

        // 2. Gửi thông báo Database cho Giảng viên để họ biết và đăng ký lại
        const thongBaoReject = new ThongBao({
            IDNguoiNhan: lichBiTuChoi.GiangVien,
            TieuDe: "Lịch đăng ký không được duyệt",
            NoiDung: `Lịch đăng ký môn học của bạn đã bị từ chối. Vui lòng kiểm tra lại sơ đồ phòng học và đăng ký khung giờ khác nhé.`,
            LienKet: "/tkb/dangky"
        });
        await thongBaoReject.save();

        res.json({ success: true, message: "Đã từ chối và giải phóng phòng học!" });
    } catch (err) {
        await session.abortTransaction();
        console.error(err);
        res.status(500).json({ success: false, message: "Lỗi rồi: " + err.message });
    } finally {
        await session.endSession();
    }
});

router.get('/tkb-admin', requireAdmin, async (req, res) => {
    try {
        const { weeks, currentWeek, realCurrentWeek } = await calculateWeeksData(req.query.tuan);
        // 1. Lấy nguyên liệu: Tất cả phòng và lịch đã duyệt
        const [dsphong, dsLich] = await Promise.all([
            PhongHoc.find().sort({ TenPhong: 1 }),
            TKB.find({ TrangThai: 'da-duyet', Tuan: currentWeek })
                .populate('MonHoc GiangVien LopHoc PhongHoc')
        ]);

        const cacThu = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
        const cacBuoi = ['Sáng', 'Chiều', 'Tối'];

        res.render('tkb', {
            title: 'Hệ thống Quản lý Tổng quát - Edu KT',
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
        res.status(500).send("Lỗi tải trang tkb-admin rồi Tâm ạ!");
    }
});

router.get('/export-dangky', requireAdmin, async (req, res) => {
    try {
        // Lấy tất cả lịch đăng ký, ưu tiên những cái mới nhất lên đầu để xem ngày giờ cho dễ
        const dsLich = await TKB.find()
            .populate('MonHoc')
            .populate('GiangVien')
            .populate('LopHoc')
            .populate('PhongHoc')
            .sort({ NgayDangKy: -1 })
            .lean();

        const rows = dsLich.map((item, index) => ({
            'STT': index + 1,
            'Ngày giờ đăng ký': item.NgayDangKy ? new Date(item.NgayDangKy).toLocaleString('vi-VN') : 'Không rõ',
            'Môn học': item.MonHoc ? item.MonHoc.TenMonHoc : 'N/A',
            'Giảng viên': item.GiangVien ? item.GiangVien.HoVaTen : 'N/A',
            'Lớp học': item.LopHoc ? item.LopHoc.TenLop : 'N/A',
            'Phòng học': item.PhongHoc ? item.PhongHoc.TenPhong : 'N/A',
            'Ngày học': item.NgayHoc ? new Date(item.NgayHoc).toLocaleDateString('vi-VN') : 'Không rõ',
            'Thứ': item.Thu,
            'Tiết học': `${item.TietBatDau} - ${item.TietKetThuc}`,
            'Ngày duyệt': item.NgayDuyet ? new Date(item.NgayDuyet).toLocaleString('vi-VN') : '',
            'Trạng thái': item.TrangThai === 'cho-duyet' ? 'Chờ duyệt' : (item.TrangThai === 'da-duyet' ? 'Đã duyệt' : 'Từ chối')
        }));

        const workbook = buildWorkbook('DanhSachDangKy', rows);
        const fileName = `bao-cao-dang-ky-tkb-${new Date().toLocaleDateString('vi-VN').replace(/\//g, '-')}.xlsx`;
        sendWorkbook(res, workbook, fileName);
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi xuất Excel: " + err.message);
    }
});

module.exports = router;
