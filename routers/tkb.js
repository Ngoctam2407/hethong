var express = require('express');
var router = express.Router();
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

// Hàm tính toán thông tin tuần học dựa trên ngày thực tế
async function calculateWeeksData(selectedTuan) {
    // Tìm lớp học có ngày bắt đầu sớm nhất, đảm bảo bỏ qua dữ liệu trống
    const firstLop = await LopHoc.findOne({ NgayBatDauNamHoc: { $exists: true, $ne: null } }).sort({ NgayBatDauNamHoc: 1 });

    let startPoint = (firstLop && firstLop.NgayBatDauNamHoc) ? new Date(firstLop.NgayBatDauNamHoc) : new Date();

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

    for (let i = 0; i < 15; i++) {
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
    const lich = await TKB.findById(lichId).populate('MonHoc GiangVien LopHoc PhongHoc');
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
            .sort({ Thu: 1, TietBatDau: 1 }); // Sắp xếp cho đẹp nè Tâm

        res.render('tkb', {
            title: 'Thời Khóa Biểu',
            user,
            dsphong: dsphong,
            cacThu: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'],
            cacBuoi: ['Sáng', 'Chiều', 'Tối'],
            dsTKB: thoiKhoaBieu, // Gửi danh sách đã lọc riêng cho từng người
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
    try {
        const { MonHoc, GiangVien, PhongHoc: phongHocID, LopHoc: lopHocID, Thu, TietBatDau, TietKetThuc, Tuan: tuanInput } = req.body;
        const tietBD = parseInt(TietBatDau, 10);
        const tietKT = parseInt(TietKetThuc, 10);
        const Tuan = parseInt(tuanInput, 10) || 1;

        const conflictQuery = { Thu, Tuan, ...timeOverlap(tietBD, tietKT) };

        // BƯỚC 1: Kiểm tra xung đột Giảng viên, Phòng, Lớp trong cùng 1 tuần
        const [gvBan, phongBan, lopBan] = await Promise.all([
            TKB.findOne({ GiangVien, ...conflictQuery }),
            TKB.findOne({ PhongHoc: phongHocID, ...conflictQuery }),
            TKB.findOne({ LopHoc: lopHocID, ...conflictQuery })
        ]);

        if (gvBan) {
            req.session.error = "Đã có lịch dạy vào khung giờ này rồi";
            return res.redirect('back');
        }

        if (lopBan) {
            req.session.error = "Lớp học này đã bận vào khung giờ này rồi";
            return res.redirect('back');
        }

        if (phongBan) {
            req.session.error = "Phòng học đã có lớp khác sử dụng vào khung giờ này rồi.";
            return res.redirect('back');
        }

        // BƯỚC 2: Kiểm tra sĩ số và sức chứa
        const [lop, phong] = await Promise.all([
            LopHoc.findById(lopHocID),
            PhongHoc.findById(phongHocID)
        ]);

        if (phong && lop && phong.SucChua < lop.SiSo) {
            req.session.error = `Phòng ${phong.TenPhong} chỉ chứa được ${phong.SucChua} bạn, mà lớp này tận ${lop.SiSo} bạn lận Tâm ạ!`;
            return res.redirect('back');
        }

        // TẤT CẢ ƯU TIÊN ĐỀU KHỚP - TIẾN HÀNH LƯU
        const caHocTuDong = tietBD <= 5 ? 'Sáng' : (tietBD <= 10 ? 'Chiều' : 'Tối');
        const moi = new TKB({
            ...req.body,
            Tuan: Tuan,
            CaHoc: caHocTuDong,
            TrangThai: 'da-duyet' // Admin thêm trực tiếp thì duyệt luôn
        });
        await moi.save();

        req.session.success = "Đã xếp lịch thành công theo đúng thứ tự ưu tiên .";

        // Lưu ý: Các biến `lichCu` và `id` bị thiếu ở route gốc, bạn nên kiểm tra lại scope
        // nếu bạn định xoá/cập nhật ở route tạo mới này.
        res.redirect('/tkb');

    } catch (err) {
        res.status(500).send("Lỗi xử lý logic: " + err);
    }
});


// GET: Hiện trang thêm TKB (Admin)
router.get('/them', requireAdmin, async (req, res) => {
    try {
        const [dsmon, dsgiangvien, dslop, dsphong] = await Promise.all([
            MonHoc.find(),
            TaiKhoan.find({ QuyenHan: 'giangvien' }),
            LopHoc.find(),
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
        const dsLopHoc = await LopHoc.find();
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
    try {
        const { TietBatDau, PhongHoc: phongMoiID, Tuan } = req.body;
        const tietBD = parseInt(TietBatDau, 10);

        const lichCu = await TKB.findById(req.params.id);
        if (!lichCu) return res.send("Khong tim thay lich nay.");

        const phongCuID = lichCu.PhongHoc.toString();
        req.body.CaHoc = tietBD <= 5 ? 'Sáng' : (tietBD <= 10 ? 'Chiều' : 'Tối');

        await TKB.findByIdAndUpdate(req.params.id, req.body);

        if (phongCuID !== phongMoiID) {
            await PhongHoc.findByIdAndUpdate(phongCuID, { TrangThai: 1 });
            await PhongHoc.findByIdAndUpdate(phongMoiID, { TrangThai: 0 });
        }

        if (lichCu.TrangThai === 'da-duyet') {
            await guiThongBaoLichHoc('cap-nhat', req.params.id);
        }

        req.session.success = "Da cap nhat lich hoc thanh cong.";
        res.redirect('/tkb');
    } catch (err) {
        console.error(err);
        res.send("Loi cap nhat: " + err.message);
    }
});

// GET: Xóa TKB
router.get('/xoa/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const lichCu = await TKB.findById(id);
        await TKB.findByIdAndDelete(id);

        if (lichCu && lichCu.TrangThai === 'da-duyet') {
            await guiThongBaoLichHoc('huy-lich', id);
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

        const dsTKB = dsLich.map(item => ({
            ...item._doc,
            ThuIndex: thuMap[item.Thu] || 2,
            SoTiet: ((item.TietKetThuc || 0) - (item.TietBatDau || 0)) + 1
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
        const dsLop = await LopHoc.find();
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
    try {
        const user = req.session.user;
        if (!user) return res.redirect('/auth/dangnhap');
        if (user.QuyenHan === 'sinhvien') {
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

        if (tietKT < tietBD) {
            req.session.error = "Tiết kết thúc phải >= tiết bắt đầu";
            return res.redirect(req.get('referer') || '/tkb/dangky');
        }

        const conflictQuery = { Thu, Tuan: tuanInt, ...timeOverlap(tietBD, tietKT) };

        // Sử dụng đúng ID đã đổi tên để kiểm tra xung đột
        const [gvConflict, roomConflict, lopConflict] = await Promise.all([
            TKB.findOne({ GiangVien: giangVienID, ...conflictQuery }),
            TKB.findOne({ PhongHoc: phongHocID, ...conflictQuery }),
            TKB.findOne({ LopHoc: lopHocID, ...conflictQuery })
        ]);

        if (gvConflict) { req.session.error = "Giảng viên đang sắp có lịch dạy giờ này"; return res.redirect(req.get('referer') || '/tkb/dangky'); }
        if (roomConflict) { req.session.error = "Phòng đang dùng giờ này"; return res.redirect(req.get('referer') || '/tkb/dangky'); }
        if (lopConflict) { req.session.error = "Lớp này đã lớp khác dạy giờ này rồi , nên không được đăng ký đâu nhé."; return res.redirect(req.get('referer') || '/tkb/dangky'); }


        const lop = await LopHoc.findById(lopHocID); // Dùng tên Model.findById(biến ID)
        const phong = await PhongHoc.findById(phongHocID);

        if (phong && lop && phong.SucChua < lop.SiSo) {
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
            TietBatDau: tietBD,
            TietKetThuc: tietKT,
            PhongHoc: phongHocID,
            CaHoc: caHocTuDong,
            TrangThai: 'cho-duyet'
        });

        await lichMoi.save();
        await PhongHoc.findByIdAndUpdate(phongHocID, { TrangThai: 0 }); // Giả sử trạng thái 0 là "Đang sử dụng" 
        req.session.success = "Đã lưu lịch rồi, chờ duyệt nhé!";
        res.redirect('/tkb');
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi server: " + err.message);
    }
});

router.use(requireAdmin);

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
    try {
        // 1. Tìm thông tin cái lịch đang định duyệt (populate để tạo nội dung thông báo)
        const lichSapDuyet = await TKB.findById(req.params.id).populate('MonHoc LopHoc');

        if (!lichSapDuyet) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch chờ duyệt.' });
        }

        // 2. Kiểm tra xem có lịch nào KHÁC đã được duyệt mà trùng Thứ, Tiết, Phòng không
        const trungLich = await TKB.findOne({
            _id: { $ne: req.params.id },
            TrangThai: 'da-duyet',
            Thu: lichSapDuyet.Thu,
            Tuan: lichSapDuyet.Tuan, // Quan trọng: Phải kiểm tra trùng theo cả Tuần học
            PhongHoc: lichSapDuyet.PhongHoc,
            $or: [
                { TietBatDau: { $lte: lichSapDuyet.TietKetThuc }, TietKetThuc: { $gte: lichSapDuyet.TietBatDau } }
            ]
        });

        if (trungLich) {
            return res.json({ success: false, message: "Phòng này đã có lịch học vào thời gian này rồi." });
        }

        // 3. Cập nhật trạng thái
        await TKB.findByIdAndUpdate(req.params.id, {
            TrangThai: 'da-duyet',
            NgayDuyet: new Date()
        });

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
        console.error(err);
        res.status(500).json({ success: false, message: "Lỗi : " + err.message });
    }
});

// Route xử lý TỪ CHỐI duyệt lịch học
router.post('/tu-choi/:id', requireAdmin, async (req, res) => {
    try {
        // 1. Chỉ cập nhật trạng thái thành 'tu-choi'
        const lichBiTuChoi = await TKB.findByIdAndUpdate(req.params.id, {
            TrangThai: 'tu-choi'
        });

        if (!lichBiTuChoi) {
            return res.json({ success: false, message: 'Không tìm thấy lịch này.' });
        }

        // 2. Gửi thông báo Database cho Giảng viên để họ biết và đăng ký lại
        const thongBaoReject = new ThongBao({
            IDNguoiNhan: lichBiTuChoi.GiangVien,
            TieuDe: "Lịch đăng ký không được duyệt",
            NoiDung: `Lịch đăng ký môn học của bạn đã bị từ chối. Vui lòng kiểm tra lại sơ đồ phòng học và đăng ký khung giờ khác nhé.`,
            LienKet: "/tkb/dangky"
        });
        await thongBaoReject.save();

        // 3. Giải phóng trạng thái phòng học về 1 (Sẵn sàng)
        await PhongHoc.findByIdAndUpdate(lichBiTuChoi.PhongHoc, { TrangThai: 1 });

        res.json({ success: true, message: "Đã từ chối và giải phóng phòng học!" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Lỗi rồi: " + err.message });
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
            'Thứ': item.Thu,
            'Tiết học': `${item.TietBatDau} - ${item.TietKetThuc}`,
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