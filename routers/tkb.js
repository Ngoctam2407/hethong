var express = require('express');
var router = express.Router();
var TKB = require('../models/tkb');
var PhongHoc = require('../models/phonghoc');
var TaiKhoan = require('../models/taikhoan');
var MonHoc = require('../models/monhoc');
var LopHoc = require('../models/lophoc');



// GET: Hiện danh sách TKB
router.get('/', async (req, res) => {
    try {
        // Populate giúp lấy thông tin chi tiết từ bảng khác qua ID
        const dsTKB = await TKB.find()
            .populate('GiangVien', 'HoVaTen')
            .populate('PhongHoc', 'TenPhong');

        res.render('tkb', {
            title: 'Thời Khóa Biểu Edu KT',
            dsTKB: dsTKB
        });
    } catch (err) {
        res.status(500).send("Lỗi rồi Tâm ơi: " + err);
    }
});

// GET: Hiện trang thêm TKB
router.post('/them', async (req, res) => {
    try {
        const { MonHoc, GiangVien, PhongHoc, LopHoc, Thu, TietBatDau, TietKetThuc } = req.body;

        // BƯỚC 1: ƯU TIÊN KHUNG GIỜ & GIẢNG VIÊN (Kiểm tra xem GV có bị kẹt giờ đó không)
        // Một giảng viên không thể ở 2 nơi cùng lúc vào một khung giờ
        const gvBan = await TKB.findOne({
            GiangVien: GiangVien,
            Thu: Thu,
            $or: [
                { TietBatDau: { $lte: TietKetThuc }, TietKetThuc: { $gte: TietBatDau } }
            ]
        });

        if (gvBan) {
            req.session.error = "Tâm ơi, Giảng viên này đã có lịch dạy vào khung giờ này rồi!";
            return res.redirect('back');
        }

        // BƯỚC 2: ƯU TIÊN SỐ LƯỢNG HỌC VIÊN (Khớp sĩ số lớp với sức chứa phòng)
        const lop = await require('../models/lophoc').findById(LopHoc);
        const phong = await PhongHoc.findById(PhongHoc);

        if (phong.SucChua < lop.SiSo) {
            req.session.error = `Phòng ${phong.TenPhong} chỉ chứa được ${phong.SucChua} bạn, mà lớp này tận ${lop.SiSo} bạn lận Tâm ạ!`;
            return res.redirect('back');
        }

        // BƯỚC 3: ƯU TIÊN PHÒNG HỌC (Kiểm tra phòng có bị trùng không)
        const phongBan = await TKB.findOne({
            PhongHoc: PhongHoc,
            Thu: Thu,
            $or: [
                { TietBatDau: { $lte: TietKetThuc }, TietKetThuc: { $gte: TietBatDau } }
            ]
        });

        if (phongBan) {
            req.session.error = `Phòng ${phong.TenPhong} đã có lớp khác sử dụng vào khung giờ này rồi.`;
            return res.redirect('back');
        }

        // TẤT CẢ ƯU TIÊN ĐỀU KHỚP - TIẾN HÀNH LƯU
        const moi = new TKB(req.body);
        await moi.save();

        req.session.success = "Đã xếp lịch thành công theo đúng thứ tự ưu tiên của Tâm! 🌸";
        res.redirect('/tkb');

    } catch (err) {
        res.status(500).send("Lỗi xử lý logic: " + err);
    }
});

// POST: Lưu TKB mới
router.post('/them', async (req, res) => {
    try {
        const moi = new TKB(req.body);
        await moi.save();
        req.session.success = "Thêm lịch học thành công rồi Tâm ơi! 🎉";
        res.redirect('/tkb');
    } catch (err) {
        res.send("Lỗi lưu TKB: " + err);
    }
});
// GET: Hiện trang Sửa TKB
router.get('/sua/:id', async (req, res) => {
    try {
        const item = await TKB.findById(req.params.id);
        const dsPhong = await PhongHoc.find();
        const dsGiangVien = await TaiKhoan.find({ QuyenHan: 'giangvien' });

        res.render('tkb_sua', {
            title: 'Chỉnh Sửa Lịch Học',
            item: item,
            dsPhong: dsPhong,
            dsGiangVien: dsGiangVien
        });
    } catch (err) {
        res.send("Lỗi không tìm thấy lịch để sửa Tâm ơi: " + err);
    }
});

// POST: Cập nhật TKB sau khi sửa
router.post('/sua/:id', async (req, res) => {
    try {
        await TKB.findByIdAndUpdate(req.params.id, req.body);
        req.session.success = "Đã cập nhật lịch học mới rồi nhé Tâm! ✨";
        res.redirect('/tkb');
    } catch (err) {
        res.send("Lỗi cập nhật rồi: " + err);
    }
});

// GET: Xóa TKB
router.get('/xoa/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await TKB.findByIdAndDelete(id);

        // Sau khi xóa xong, quay lại trang bảng lịch
        res.redirect('/tkb');
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi xóa lịch rồi Tâm ơi!");
    }
});
router.get('/thoi-khoa-bieu-luoi', async (req, res) => {
    try {
        // Lấy toàn bộ lịch (Tâm có thể thêm .find({ LopHoc: ... }) để lọc riêng nhé)
        const dsLich = await TKB.find()
            .populate('GiangVien')
            .populate('PhongHoc');

        // Gửi dữ liệu sang view
        res.render('tkb_luoi', { dsLich });
    } catch (err) {
        res.status(500).send("Có lỗi khi tải lịch rồi Tâm ơi!");
    }
});

router.get('/ngay', async (req, res) => {
    try {
        const user = req.session.user;
        if (!user) return res.redirect('/dangnhap');

        // Lấy thứ hiện tại (JS: 0 là CN, 1 là Thứ 2... nên ta cần biến đổi xíu)
        const ngayHienTai = new Date().getDay() + 1;
        const tenThu = ngayHienTai === 1 ? "Chủ Nhật" : "Thứ " + ngayHienTai;

        // Lọc lịch học dựa theo quyền hạn và đúng Thứ của ngày hôm nay
        let query = { Thu: tenThu };
        if (user.QuyenHan === 'giangvien') query.GiangVien = user._id;
        if (user.QuyenHan === 'sinhvien') query.LopHoc = user.LopHoc;

        const dsLichHomNay = await TKB.find(query)
            .populate('MonHoc PhongHoc GiangVien');

        res.render('tkb_ngay', {
            title: 'Lịch học hôm nay',
            dsLich: dsLichHomNay,
            thu: tenThu
        });
    } catch (err) {
        res.status(500).send("Lỗi rồi Tâm ơi: " + err);
    }
});

// Trong file routers/taikhoan.js
// Route hiển thị trang đăng ký
router.get('/dangky', async (req, res) => {
    try {
        // Tâm lưu ý: Trong Database em dùng 'QuyenHan' (không dùng 'role')
        // Mình đang dùng field QuyenHan trong collection TaiKhoan
        const dsGiangVien = await TaiKhoan.find({ QuyenHan: 'giangvien' });
        const dsMon = await MonHoc.find();
        const dsPhong = await PhongHoc.find();
        const dsCaHoc = ['Sáng', 'Chiều', 'Tối'];

        // Sửa lỗi ở đây: Dùng LopHoc (đã require ở dòng 7) thay vì Lop
        const dsLop = await LopHoc.find();

        res.render('tkb_dangky', {
            title: 'Đăng ký học phần Edu KT',
            dsmon: dsMon,
            dsphong: dsPhong,
            dsgiangvien: dsGiangVien,
            dslop: dsLop,
            dscaHoc: dsCaHoc
        });
    } catch (err) {
        console.error("Lỗi lọc dữ liệu Tâm ơi:", err);
        res.status(500).send("Lỗi rồi! Tâm kiểm tra Terminal xem lỗi gì nha.");
    }
});

// Route lưu dữ liệu
router.post('/dang-ky-luu', async (req, res) => {
    try {
        const { MonHoc, GiangVien, LopHoc, Thu, TietBatDau, TietKetThuc, PhongHoc } = req.body;

        // --- ĐOẠN TỰ TÍNH CA HỌC CỦA TÂM NÈ ---
        let caHocTuDong = "";
        const tietBD = parseInt(TietBatDau);
        const tietKT = parseInt(TietKetThuc);

        if (tietBD >= 1 && tietBD <= 5) {
            caHocTuDong = "Sáng";
        } else if (tietBD >= 6 && tietBD <= 10) {
            caHocTuDong = "Chiều";
        } else {
            caHocTuDong = "Tối";
        }
        // --------------------------------------

        // VALIDATION đơn giản: tiết kết thúc không được nhỏ hơn tiết bắt đầu
        if (tietKT < tietBD) {
            req.session.error = "Tiết kết thúc phải lớn hơn hoặc bằng tiết bắt đầu.";
            return res.redirect('back');
        }

        const lichMoi = new TKB({
            MonHoc: MonHoc,
            GiangVien: GiangVien,
            LopHoc: LopHoc,
            Thu: Thu,
            TietBatDau: tietBD,
            TietKetThuc: tietKT,
            PhongHoc: PhongHoc,
            CaHoc: caHocTuDong // Đưa giá trị vừa tính vào đây
        });

        await lichMoi.save();
        req.session.success = "Đã tự động tính ca và lưu lịch thành công rồi Tâm ơi! ✨";
        res.redirect('/tkb');

    } catch (err) {
        console.error(err);
        res.status(500).send("Vẫn lỗi rồi Tâm ơi: " + err.message);
    }
});

router.get('/danhsach', async (req, res) => {
    try {
        // Tâm lưu ý: Phải có .populate để nó hiện ra Tên Môn, Tên Phòng nhé
        const dsLich = await TKB.find()
            .populate('MonHoc')
            .populate('GiangVien')
            .populate('LopHoc')
            .populate('PhongHoc');

        res.render('tkb_danhsach', {
            title: 'Lịch học của Tâm',
            dstkb: dsLich // Gửi dữ liệu lịch học sang EJS
        });
    } catch (err) {
        res.status(500).send("Lỗi rồi Tâm ơi!");
    }
});

// Trong hàm render trang danh sách lịch học
router.get('/danhsachcho', async (req, res) => {
    // Chỉ lấy những cái có TrangThai là 'cho-duyet'
    const ds = await TKB.find({ TrangThai: 'cho-duyet' }).populate('MonHoc LopHoc GiangVien PhongHoc');
    res.render('tkb', { dstkb: ds, title: 'Duyệt Lịch Học' });
});

// Route xử lý duyệt lịch học
router.post('/duyet/:id', async (req, res) => {
    try {
        const id = req.params.id;
        // Kiểm tra xem biến Tkb này đã trùng với tên em require ở đầu file chưa
        await TKB.findByIdAndUpdate(id, { TrangThai: 'da-duyet' });

        res.json({ success: true });
    } catch (err) {
        console.error("Lỗi nè Tâm ơi:", err);
        res.json({ success: false, message: "Server chưa nhận ra Model Tkb" });
    }
});
module.exports = router;