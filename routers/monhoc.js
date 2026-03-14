const express = require('express');
const router = express.Router();
const MonHoc = require('../models/monhoc'); // Model mà chúng mình vừa bàn ở trên nè
var { requireAdmin } = require('./auth');

router.use(requireAdmin);
// 1. Trang danh sách môn học
router.get('/', async (req, res) => {
    const dsMonHoc = await MonHoc.find();
    res.render('monhoc', { title: 'Quản lý môn học', dsMonHoc });
});

// 2. Trang thêm môn học
router.get('/them', (req, res) => {
    res.render('monhoc_them', { title: 'Thêm môn học mới' });
});

// 3. Xử lý thêm môn học mới
router.post('/them', async (req, res) => {
    try {
        const { TenMonHoc, MaMonHoc, SoTinChi, MoTa } = req.body;
        const monMoi = new MonHoc({ TenMonHoc, MaMonHoc, SoTinChi, MoTa });
        await monMoi.save();
        res.redirect('/monhoc');
    } catch (err) {
        res.send("Có lỗi xảy ra rồi Tâm ơi: " + err);
    }
});

// 4. Trang sửa môn học
router.get('/sua/:id', async (req, res) => {
    try {
        const monhoc = await MonHoc.findById(req.params.id);
        if (!monhoc) {
            return res.send("Không tìm thấy môn học");
        }
        res.render('monhoc_sua', { title: 'Sửa môn học', monhoc });
    } catch (err) {
        res.send("Lỗi: " + err);
    }
});

// 5. Xử lý sửa môn học
router.post('/sua/:id', async (req, res) => {
    try {
        const { TenMonHoc, MaMonHoc, SoTinChi, MoTa } = req.body;
        await MonHoc.findByIdAndUpdate(req.params.id, { TenMonHoc, MaMonHoc, SoTinChi, MoTa });
        res.redirect('/monhoc');
    } catch (err) {
        res.send("Lỗi cập nhật: " + err);
    }
});

// 6. Xóa môn học
router.get('/xoa/:id', async (req, res) => {
    try {
        await MonHoc.findByIdAndDelete(req.params.id);
        res.redirect('/monhoc');
    } catch (err) {
        res.send("Lỗi xóa: " + err);
    }
});

module.exports = router;