var express = require('express');
var router = express.Router();
var PhongHoc = require('../models/phonghoc');
var TKB = require('../models/tkb');
var { requireAdmin } = require('./auth');

router.use(requireAdmin);

const khungGioHoc = [
    { tiet: 1, batDau: '07:00', ketThuc: '07:45' },
    { tiet: 2, batDau: '07:45', ketThuc: '08:30' },
    { tiet: 3, batDau: '08:30', ketThuc: '09:15' },
    { tiet: 4, batDau: '09:15', ketThuc: '10:00' },
    { tiet: 5, batDau: '10:00', ketThuc: '10:45' },
    { tiet: 6, batDau: '13:00', ketThuc: '13:45' },
    { tiet: 7, batDau: '13:45', ketThuc: '14:30' },
    { tiet: 8, batDau: '14:30', ketThuc: '15:15' },
    { tiet: 9, batDau: '15:15', ketThuc: '16:00' },
    { tiet: 10, batDau: '16:00', ketThuc: '16:45' },
    { tiet: 11, batDau: '18:00', ketThuc: '18:45' },
    { tiet: 12, batDau: '18:45', ketThuc: '19:30' }
];

function layTietHienTai() {
    const gioHienTai = new Date().toTimeString().slice(0, 5);
    const khung = khungGioHoc.find(function (item) {
        return gioHienTai >= item.batDau && gioHienTai < item.ketThuc;
    });

    return khung ? khung.tiet : null;
}

function layKhoangNgayHomNay() {
    const batDau = new Date();
    batDau.setHours(0, 0, 0, 0);

    const ketThuc = new Date(batDau);
    ketThuc.setDate(ketThuc.getDate() + 1);

    return { batDau, ketThuc };
}

router.get('/', async (req, res) => {
    try {
        const tietHienTai = layTietHienTai();
        const { batDau, ketThuc } = layKhoangNgayHomNay();
        const [ds, lichTuanNay] = await Promise.all([
            PhongHoc.find().sort({ TenPhong: 1 }).lean(),
            tietHienTai
                ? TKB.find({
                    TrangThai: 'da-duyet',
                    NgayHoc: { $gte: batDau, $lt: ketThuc },
                    TietBatDau: { $lte: tietHienTai },
                    TietKetThuc: { $gte: tietHienTai }
                })
                    .populate('MonHoc', 'TenMonHoc')
                    .populate('LopHoc', 'TenLop')
                    .populate('GiangVien', 'HoVaTen')
                    .select('PhongHoc MonHoc LopHoc GiangVien TietBatDau TietKetThuc')
                    .lean()
                : []
        ]);

        const lichDangDungTheoPhong = new Map();
        lichTuanNay.forEach(function (item) {
            if (item && item.PhongHoc) {
                lichDangDungTheoPhong.set(item.PhongHoc.toString(), item);
            }
        });

        const dsPhongHienThi = ds.map(function (phong) {
            let trangThaiHienThi = 'trong';
            const lichDangSuDung = lichDangDungTheoPhong.get(phong._id.toString()) || null;

            if (phong.KhoaThuCong) {
                trangThaiHienThi = 'bao-tri';
            } else if (lichDangSuDung) {
                trangThaiHienThi = 'dang-su-dung';
            }

            return Object.assign({}, phong, {
                TrangThaiHienThi: trangThaiHienThi,
                LichDangSuDung: lichDangSuDung
            });
        });

        res.render('phonghoc', {
            title: 'Danh sách phòng học',
            dsphong: dsPhongHienThi,
            tietHienTai: tietHienTai
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
