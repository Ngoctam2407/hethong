var express = require('express');
var router = express.Router();
var TKB = require('../models/tkb');
var PhongHoc = require('../models/phonghoc');
var TaiKhoan = require('../models/taikhoan');
var MonHoc = require('../models/monhoc');
var LopHoc = require('../models/lophoc');

// helpers
const timeOverlap = (start, end) => ({
    $or: [
        { TietBatDau: { $lte: end }, TietKetThuc: { $gte: start } }
    ]
});

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
        // 1. Chỉ lấy những lịch đã được duyệt
        const dsLich = await TKB.find({ TrangThai: 'da-duyet' })
            .populate('MonHoc')
            .populate('PhongHoc')
            .populate('GiangVien');

        // 2. Map dữ liệu để tính toán vị trí Grid cho EJS dễ vẽ
        const dsTKB = dsLich.map(item => {
            // Chuyển "Thứ 2" thành cột 2, "Thứ 3" thành cột 3...
            // Nếu DB của Tâm lưu là "Thứ 2", "Thứ 3" thì dùng logic này:
            let thuIndex = 2; // Mặc định thứ 2
            if (item.Thu === 'Thứ 3') thuIndex = 3;
            else if (item.Thu === 'Thứ 4') thuIndex = 4;
            else if (item.Thu === 'Thứ 5') thuIndex = 5;
            else if (item.Thu === 'Thứ 6') thuIndex = 6;
            else if (item.Thu === 'Thứ 7') thuIndex = 7;
            else if (item.Thu === 'Chủ Nhật') thuIndex = 8;

            return {
                ...item._doc,
                ThuIndex: thuIndex,
                // Tính số tiết để biết cái thẻ kéo dài bao nhiêu ô (span)
                SoTiet: (item.TietKetThuc - item.TietBatDau) + 1
            };

        });

        res.render('tkb_luoi', { // Tên file EJS của Tâm
            title: 'Thời Khóa Biểu Của Tâm',
            dsTKB: dsTKB
        });
    } catch (err) {
        res.status(500).send("Lỗi lưới: " + err.message);
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
        const tietBD = parseInt(TietBatDau, 10);
        const tietKT = parseInt(TietKetThuc, 10);

        if (tietKT < tietBD) {
            req.session.error = "Tiết kết thúc phải >= tiết bắt đầu";
            return res.redirect('back');
        }

        const conflictQuery = {
            Thu,
            ...timeOverlap(tietBD, tietKT)
        };

        const [gvConflict, roomConflict, lopConflict] = await Promise.all([
            TKB.findOne({ GiangVien, ...conflictQuery }),
            TKB.findOne({ PhongHoc, ...conflictQuery }),
            TKB.findOne({ LopHoc, ...conflictQuery })
        ]);

        if (gvConflict) {
            req.session.error = "Giảng viên đang bận giờ này";
            return res.redirect('back');
        }
        if (roomConflict) {
            req.session.error = "Phòng đang dùng giờ này";
            return res.redirect('back');
        }
        if (lopConflict) {
            req.session.error = "Lớp này đã có tiết khác giờ này";
            return res.redirect('back');
        }

        // optional: phòng chứa >= sĩ số
        const lop = await LopHoc.findById(LopHoc);
        const phong = await PhongHoc.findById(PhongHoc);
        if (phong.SucChua < lop.SiSo) {
            req.session.error = `Phòng ${phong.TenPhong} chỉ chứa ${phong.SucChua}, Lớp ${lop.SiSo}`;
            return res.redirect('back');
        }

        const caHocTuDong = tietBD <= 5 ? 'Sáng' : (tietBD <= 10 ? 'Chiều' : 'Tối');

        const lichMoi = new TKB({
            MonHoc, GiangVien, LopHoc, Thu,
            TietBatDau: tietBD, TietKetThuc: tietKT, PhongHoc,
            CaHoc: caHocTuDong, TrangThai: 'cho-duyet' // nếu có
        });

        await lichMoi.save();
        req.session.success = "Lưu lịch thành công";
        res.redirect('/tkb');
    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi server: " + err.message);
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
router.post('/duyet/:id', async (req, res) => {
    try {
        // 1. Tìm thông tin cái lịch đang định duyệt
        const lichSapDuyet = await TKB.findById(req.params.id);

        // 2. Kiểm tra xem có lịch nào KHÁC đã được duyệt mà trùng Thứ, Tiết, Phòng không
        const trungLich = await TKB.findOne({
            _id: { $ne: req.params.id }, // Không so sánh với chính nó
            TrangThai: 'da-duyet',
            Thu: lichSapDuyet.Thu,
            PhongHoc: lichSapDuyet.PhongHoc,
            $or: [
                { TietBatDau: { $lte: lichSapDuyet.TietKetThuc }, TietKetThuc: { $gte: lichSapDuyet.TietBatDau } }
            ]
        });

        if (trungLich) {
            return res.json({ success: false, message: "Phòng này đã có lịch học vào thời gian này rồi Tâm ơi!" });
        }

        // 3. Nếu không trùng thì mới cho duyệt
        await TKB.findByIdAndUpdate(req.params.id, { TrangThai: 'da-duyet' });
        res.json({ success: true, message: "Đã duyệt thành công!" });

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
module.exports = router;