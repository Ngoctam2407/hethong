var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var TaiKhoan = require('../models/taikhoan');
var { requireAdmin } = require('./auth');

router.use(requireAdmin);
// 1. GET: Danh sách (Địa chỉ: /taikhoan)
router.get('/', async (req, res) => {
    var tk = await TaiKhoan.find();
    res.render('taikhoan', { title: 'Danh sách tài khoản', taikhoan: tk });
});

// 2. GET: Form Thêm (Địa chỉ: /taikhoan/them)
router.get('/them', (req, res) => {
    res.render('taikhoan_them', { title: 'Thêm tài khoản' });
});

// 3. POST: Xử lý Thêm
router.post('/them', async (req, res) => {

    if (!req.body) {
        return res.send("Không nhận được dữ liệu form");
    }

    if (!req.body.HoVaTen) {
        return res.send("Thiếu họ và tên");
    }

    var salt = bcrypt.genSaltSync(10);

    var data = {
        HoVaTen: req.body.HoVaTen,
        Email: req.body.Email,
        TenDangNhap: req.body.TenDangNhap,
        MatKhau: bcrypt.hashSync(req.body.MatKhau, salt),
        QuyenHan: req.body.QuyenHan,
        TrangThai: 1
    };

    await TaiKhoan.create(data);

    res.redirect('/taikhoan');
});

// 4. GET: Form Sửa (Địa chỉ: /taikhoan/sua/:id)
router.get('/sua/:id', async (req, res) => {
    var data = await TaiKhoan.findById(req.params.id);
    res.render('taikhoan_sua', { title: 'Sửa tài khoản', tk: data });
});

// 5. POST: Xử lý Cập nhật
router.post('/sua/:id', async (req, res) => {
    var data = {
        HoVaTen: req.body.HoVaTen,
        Email: req.body.Email,
        QuyenHan: req.body.QuyenHan,
        TrangThai: req.body.TrangThai
    };
    if (req.body.MatKhau) {
        var salt = bcrypt.genSaltSync(10);
        data['MatKhau'] = bcrypt.hashSync(req.body.MatKhau, salt);
    }
    await TaiKhoan.findByIdAndUpdate(req.params.id, data);
    res.redirect('/taikhoan');
});

// 6. GET: Xóa (Địa chỉ: /taikhoan/xoa/:id)
router.get('/xoa/:id', async (req, res) => {
    await TaiKhoan.findByIdAndDelete(req.params.id);
    res.redirect('/taikhoan');
});

// 7. GET: Chuyển đổi trạng thái khóa/mở (Địa chỉ: /taikhoan/trangthai/:id)
router.get('/trangthai/:id', async (req, res) => {
    try {
        // 1. Tìm tài khoản hiện tại
        var tk = await TaiKhoan.findById(req.params.id);

        // 2. Đảo ngược trạng thái (Nếu 1 thì thành 0, nếu 0 thì thành 1)
        var trangThaiMoi = (tk.TrangThai == 1) ? 0 : 1;

        // 3. Cập nhật vào Database
        await TaiKhoan.findByIdAndUpdate(req.params.id, { TrangThai: trangThaiMoi });

        // 4. Thông báo cho Tâm biết nè
        req.session.success = "Đã cập nhật trạng thái cho " + tk.HoVaTen + " thành công!";
        res.redirect('/taikhoan');
    } catch (err) {
        req.session.error = "Lỗi khi đổi trạng thái: " + err.message;
        res.redirect('/taikhoan');
    }
});


module.exports = router;