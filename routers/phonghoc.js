var express = require('express');
var router = express.Router();
var PhongHoc = require('../models/phonghoc'); // Nhớ tạo model này trước nha Tâm
var { requireAdmin } = require('./auth');

router.use(requireAdmin);

// 1. GET: Danh sách phòng học (Địa chỉ: /phonghoc)
router.get('/', async (req, res) => {
    try {
        var ds = await PhongHoc.find().sort({ TenPhong: 1 });

        // Sau đó truyền biến ds này vào trang ejs như bình thường
        res.render('phonghoc', {
            title: 'Danh sách phòng học',
            dsphong: ds // Nhớ kiểm tra tên biến này khớp với file EJS của em nhé
        });
    } catch (err) {
        console.error(err);
        res.send("Có lỗi khi lấy danh sách phòng");
    }
});

// 2. GET: Form Thêm phòng (Địa chỉ: /phonghoc/them)
router.get('/them', (req, res) => {
    res.render('phonghoc_them', { title: 'Thêm phòng học mới' });
});

// 3. POST: Xử lý Thêm phòng
router.post('/them', async (req, res) => {
    if (!req.body || !req.body.TenPhong) {
        return res.send("Tâm ơi, thiếu tên phòng mất rồi!");
    }

    var data = {
        TenPhong: req.body.TenPhong,
        LoaiPhong: req.body.LoaiPhong, // Lý thuyết / Thực hành
        SucChua: req.body.SucChua,
        GhiChu: req.body.GhiChu,
        TrangThai: 1 // Mặc định phòng mới tạo là sẵn sàng dùng
    };

    await PhongHoc.create(data);
    res.redirect('/phonghoc');
});

// 4. GET: Form Sửa phòng (Địa chỉ: /phonghoc/sua/:id)
router.get('/sua/:id', async (req, res) => {
    var data = await PhongHoc.findById(req.params.id);
    res.render('phonghoc_sua', { title: 'Cập nhật phòng học', phong: data });
});

// 5. POST: Xử lý Cập nhật phòng
router.post('/sua/:id', async (req, res) => {
    var data = {
        TenPhong: req.body.TenPhong,
        LoaiPhong: req.body.LoaiPhong,
        SucChua: req.body.SucChua,
        GhiChu: req.body.GhiChu,
        TrangThai: req.body.TrangThai
    };

    await PhongHoc.findByIdAndUpdate(req.params.id, data);
    res.redirect('/phonghoc');
});

// 6. GET: Xóa phòng (Địa chỉ: /phonghoc/xoa/:id)
router.get('/xoa/:id', async (req, res) => {
    await PhongHoc.findByIdAndDelete(req.params.id);
    res.redirect('/phonghoc');
});

// 7. GET: Chuyển đổi trạng thái (Đang dùng / Bảo trì)
router.get('/trangthai/:id', async (req, res) => {
    try {
        var phong = await PhongHoc.findById(req.params.id);
        var trangThaiMoi = (phong.TrangThai == 1) ? 0 : 1;

        await PhongHoc.findByIdAndUpdate(req.params.id, { TrangThai: trangThaiMoi });

        req.session.success = "Đã cập nhật trạng thái phòng " + phong.TenPhong + " thành công!";
        res.redirect('/phonghoc');
    } catch (err) {
        req.session.error = "Lỗi khi đổi trạng thái phòng: " + err.message;
        res.redirect('/phonghoc');
    }
});

module.exports = router;