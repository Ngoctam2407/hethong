var express = require('express');
var router = express.Router();
var PhongHoc = require('../models/phonghoc');
var LopHoc = require('../models/lophoc');
var TKB = require('../models/tkb');
var { requireAdmin } = require('./auth');
var { taoDuLieuTuanHoc } = require('../utils/date');

router.use(requireAdmin);

async function layTuanThucTeHienTai() {
    const firstLop = await LopHoc.findOne({
        NgayBatDauNamHoc: { $exists: true, $ne: null }
    }).sort({ NgayBatDauNamHoc: 1 }).select('NgayBatDauNamHoc');

    const weekData = taoDuLieuTuanHoc(firstLop && firstLop.NgayBatDauNamHoc ? firstLop.NgayBatDauNamHoc : new Date());
    return weekData.realCurrentWeek;
}

router.get('/', async (req, res) => {
    try {
        const currentWeek = await layTuanThucTeHienTai();
        const [ds, lichTuanNay] = await Promise.all([
            PhongHoc.find().sort({ TenPhong: 1 }).lean(),
            TKB.find({ TrangThai: 'da-duyet', Tuan: currentWeek }).select('PhongHoc').lean()
        ]);

        const phongDangDuocSuDung = new Set(
            lichTuanNay
                .filter(function (item) { return item && item.PhongHoc; })
                .map(function (item) { return item.PhongHoc.toString(); })
        );

        const dsPhongHienThi = ds.map(function (phong) {
            let trangThaiHienThi = 'trong';

            if (phong.KhoaThuCong) {
                trangThaiHienThi = 'bao-tri';
            } else if (phongDangDuocSuDung.has(phong._id.toString())) {
                trangThaiHienThi = 'dang-su-dung';
            }

            return Object.assign({}, phong, {
                TrangThaiHienThi: trangThaiHienThi
            });
        });

        res.render('phonghoc', {
            title: 'Danh sách phòng học',
            dsphong: dsPhongHienThi
        });
    } catch (err) {
        console.error(err);
        res.send('Có lỗi khi lấy danh sách phòng');
    }
});

router.get('/them', function (req, res) {
    res.render('phonghoc_them', { title: 'Thêm phòng học mới' });
});

router.post('/them', async function (req, res) {
    if (!req.body || !req.body.TenPhong) {
        return res.send('Thiếu tên phòng.');
    }

    await PhongHoc.create({
        TenPhong: req.body.TenPhong,
        LoaiPhong: req.body.LoaiPhong,
        SucChua: req.body.SucChua,
        GhiChu: req.body.GhiChu,
        KhoaThuCong: false,
        TrangThai: 1
    });

    res.redirect('/phonghoc');
});

router.get('/sua/:id', async function (req, res) {
    var data = await PhongHoc.findById(req.params.id);
    res.render('phonghoc_sua', { title: 'Cập nhật phòng học', phong: data });
});

router.post('/sua/:id', async function (req, res) {
    await PhongHoc.findByIdAndUpdate(req.params.id, {
        TenPhong: req.body.TenPhong,
        LoaiPhong: req.body.LoaiPhong,
        SucChua: req.body.SucChua,
        GhiChu: req.body.GhiChu,
        KhoaThuCong: req.body.KhoaThuCong === '1'
    });

    res.redirect('/phonghoc');
});

router.get('/xoa/:id', async function (req, res) {
    await PhongHoc.findByIdAndDelete(req.params.id);
    res.redirect('/phonghoc');
});

router.get('/trangthai/:id', async function (req, res) {
    try {
        var phong = await PhongHoc.findById(req.params.id);
        var khoaThuCongMoi = !phong.KhoaThuCong;

        await PhongHoc.findByIdAndUpdate(req.params.id, { KhoaThuCong: khoaThuCongMoi });

        req.session.success = khoaThuCongMoi
            ? 'Đã chuyển phòng ' + phong.TenPhong + ' sang trạng thái bảo trì.'
            : 'Đã mở lại phòng ' + phong.TenPhong + ' để sẵn sàng sử dụng.';

        res.redirect('/phonghoc');
    } catch (err) {
        req.session.error = ' lỗi khi đổi trạng thái phòng: ' + err.message;
        res.redirect('/phonghoc');
    }
});

module.exports = router;
