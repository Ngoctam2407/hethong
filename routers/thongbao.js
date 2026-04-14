var express = require('express');
var router = express.Router();
var ThongBao = require('../models/thongbao');

// Lấy danh sách 10 thông báo mới nhất của người dùng
router.get('/danh-sach', async function (req, res) {
    try {
        var userId = req.session.user._id;
        var ds = await ThongBao.find({ IDNguoiNhan: userId })
            .sort({ createdAt: -1 })
            .limit(10);
        res.json(ds);
    } catch (err) {
        res.status(500).json({ msg: "Lỗi " });
    }
});

// Đánh dấu đã xem
router.post('/da-xem/:id', async function (req, res) {
    await ThongBao.findByIdAndUpdate(req.params.id, { DaXem: true });
    res.json({ success: true });
});

module.exports = router;