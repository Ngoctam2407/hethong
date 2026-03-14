var express = require('express');
var router = express.Router();
var TKB = require('../models/tkb');
var PhongHoc = require('../models/phonghoc');
var TaiKhoan = require('../models/taikhoan');

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
router.get('/them', async (req, res) => {
    try {
        const dsPhong = await PhongHoc.find();
        const dsGiangVien = await TaiKhoan.find({ QuyenHan: 'giangvien' });

        res.render('tkb_them', {
            title: 'Thêm Lịch Học Mới',
            dsPhong: dsPhong,
            dsGiangVien: dsGiangVien
        });
    } catch (err) {
        res.send("Lỗi lấy dữ liệu: " + err);
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
        await TKB.findByIdAndDelete(req.params.id);
        req.session.success = "Đã xóa lịch học theo ý Tâm rồi đó! 🗑️";
        res.redirect('/tkb');
    } catch (err) {
        res.send("Lỗi khi xóa rồi: " + err);
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
module.exports = router;