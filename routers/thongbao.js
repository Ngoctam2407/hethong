var express = require('express');
var router = express.Router();
var ThongBao = require('../models/thongbao');
var { requireLogin } = require('./auth');

// Middleware: Kiểm tra đăng nhập
router.use(requireLogin);

// Lấy danh sách 10 thông báo mới nhất của người dùng (Cho dropdown) - PHẢI TRƯỚC route '/'
router.get('/danh-sach', async function (req, res) {
    try {
        var userId = req.session.user._id;

        // Tính ngày 30 ngày trước
        var ngayHomNay = new Date();
        var ngay30NgayTruoc = new Date(ngayHomNay);
        ngay30NgayTruoc.setDate(ngay30NgayTruoc.getDate() - 30);

        // Lấy tất cả thông báo trong 30 ngày gần đây, hiển thị 10 cái mới nhất
        var ds = await ThongBao.find({
            IDNguoiNhan: userId,
            createdAt: { $gte: ngay30NgayTruoc, $lte: ngayHomNay }
        })
            .sort({ createdAt: -1 })
            .limit(10);
        res.json(ds);
    } catch (err) {
        res.status(500).json({ msg: "Lỗi " });
    }
});

// GET: Trang xem tất cả thông báo (30 ngày gần đây)
router.get('/', async function (req, res) {
    try {
        var userId = req.session.user._id;

        // Tính ngày 30 ngày trước
        var ngayHomNay = new Date();
        var ngay30NgayTruoc = new Date(ngayHomNay);
        ngay30NgayTruoc.setDate(ngay30NgayTruoc.getDate() - 30);

        // Lấy tất cả thông báo trong 30 ngày gần đây
        var ds = await ThongBao.find({
            IDNguoiNhan: userId,
            createdAt: { $gte: ngay30NgayTruoc, $lte: ngayHomNay }
        })
            .sort({ createdAt: -1 });

        res.render('thongbao', {
            title: 'Xem tất cả thông báo',
            path: '/thongbao',
            dsThongBao: ds,
            user: req.session.user,
            isLoggedIn: !!req.session.user
        });
    } catch (err) {
        console.error('Lỗi xem thông báo:', err);
        res.status(500).send("Lỗi khi lấy thông báo rồi!");
    }
});

// Đánh dấu đã xem
router.post('/da-xem/:id', async function (req, res) {
    await ThongBao.findByIdAndUpdate(req.params.id, { DaXem: true });
    res.json({ success: true });
});

module.exports = router;