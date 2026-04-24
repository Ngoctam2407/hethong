var express = require('express');
var router = express.Router();
var LopHoc = require('../models/lophoc');
var MonHoc = require('../models/monhoc');
var { requireAdmin } = require('./auth');
var { upload, readRowsFromExcel, buildWorkbook, sendWorkbook, toNumber } = require('../utils/excel');

function xuLyUploadExcel(req, res, next) {
    upload.single('excelFile')(req, res, function (err) {
        if (err) {
            req.session.error = err.message;
            return res.redirect('/lophoc');
        }
        next();
    });
}

function layGiaTriDong(dong, truong) {
    return dong[truong] || dong[truong.toLowerCase()] || '';
}

function chuanHoaDanhSachMonHoc(duLieu) {
    if (!duLieu) return [];
    if (Array.isArray(duLieu)) return duLieu.filter(Boolean);
    return [duLieu].filter(Boolean);
}

router.use(requireAdmin);

router.get('/', async function (req, res) {
    try {
        var dsLop = await LopHoc.find()
            .populate('DanhSachMonHoc', 'TenMonHoc')
            .sort({ MaLop: 1 });

        res.render('lophoc', {
            title: 'Quản Lý Lớp Học',
            dsLopHoc: dsLop
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Có lỗi xảy ra khi lấy danh sách lớp học.');
    }
});

router.post('/import', xuLyUploadExcel, async function (req, res) {
    try {
        if (!req.file) {
            req.session.error = 'Ban can chon file Excel truoc khi import.';
            return res.redirect('/lophoc');
        }

        const rows = readRowsFromExcel(req.file.buffer);
        if (!rows.length) {
            req.session.error = 'File Excel khong co dong du lieu nao.';
            return res.redirect('/lophoc');
        }

        const dsMon = await MonHoc.find().select('_id TenMonHoc MaMonHoc').lean();
        const mapMon = new Map();
        dsMon.forEach(function (mon) {
            mapMon.set(String(mon.TenMonHoc || '').trim().toLowerCase(), mon._id);
            mapMon.set(String(mon.MaMonHoc || '').trim().toLowerCase(), mon._id);
        });

        let taoMoi = 0;
        let capNhat = 0;

        for (const row of rows) {
            const MaLop = String(layGiaTriDong(row, 'MaLop')).trim();
            const TenLop = String(layGiaTriDong(row, 'TenLop')).trim();

            if (!MaLop || !TenLop) {
                continue;
            }

            const danhSachMonHoc = String(layGiaTriDong(row, 'DanhSachMonHoc'))
                .split(',')
                .map(function (item) { return String(item || '').trim().toLowerCase(); })
                .filter(Boolean)
                .map(function (item) { return mapMon.get(item); })
                .filter(Boolean);

            const duLieu = {
                MaLop: MaLop,
                TenLop: TenLop,
                NienKhoa: String(layGiaTriDong(row, 'NienKhoa')).trim(),
                NgayBatDauNamHoc: layGiaTriDong(row, 'NgayBatDauNamHoc') ? new Date(layGiaTriDong(row, 'NgayBatDauNamHoc')) : new Date(),
                SiSo: toNumber(layGiaTriDong(row, 'SiSo'), 0),
                DanhSachMonHoc: danhSachMonHoc,
                TrangThai: toNumber(layGiaTriDong(row, 'TrangThai'), 1)
            };

            const lopCu = await LopHoc.findOne({ MaLop: MaLop });
            if (lopCu) {
                await LopHoc.findByIdAndUpdate(lopCu._id, duLieu);
                capNhat++;
            } else {
                await LopHoc.create(duLieu);
                taoMoi++;
            }
        }

        req.session.success = 'Import lop hoc thanh cong: ' + taoMoi + ' ban ghi moi, ' + capNhat + ' ban ghi cap nhat.';
        res.redirect('/lophoc');
    } catch (err) {
        console.error(err);
        req.session.error = 'Loi import lop hoc: ' + err.message;
        res.redirect('/lophoc');
    }
});

router.get('/export', async function (req, res) {
    try {
        const dsLop = await LopHoc.find()
            .populate('DanhSachMonHoc', 'TenMonHoc')
            .sort({ MaLop: 1 })
            .lean();

        const rows = dsLop.map(function (lop) {
            return {
                MaLop: lop.MaLop,
                TenLop: lop.TenLop,
                NienKhoa: lop.NienKhoa || '',
                SiSo: lop.SiSo || 0,
                DanhSachMonHoc: Array.isArray(lop.DanhSachMonHoc) ? lop.DanhSachMonHoc.map(function (mon) {
                    return mon.TenMonHoc;
                }).join(', ') : '',
                TrangThai: lop.TrangThai
            };
        });

        const workbook = buildWorkbook('LopHoc', rows);
        sendWorkbook(res, workbook, 'lophoc.xlsx');
    } catch (err) {
        console.error(err);
        req.session.error = 'Khong the export lop hoc: ' + err.message;
        res.redirect('/lophoc');
    }
});

router.get('/them', async function (req, res) {
    try {
        const dsMonHoc = await MonHoc.find().sort({ TenMonHoc: 1 });
        res.render('lophoc_them', {
            title: 'Tạo Lớp Học Mới',
            dsMonHoc: dsMonHoc
        });
    } catch (err) {
        res.status(500).send('Loi tai mon hoc: ' + err.message);
    }
});

router.post('/them', async function (req, res) {
    try {
        if (!req.body || !req.body.MaLop || !req.body.TenLop) {
            return res.send('Ban can nhap MaLop va TenLop.');
        }

        var data = {
            MaLop: req.body.MaLop,
            TenLop: req.body.TenLop,
            NienKhoa: req.body.NienKhoa,
            NgayBatDauNamHoc: req.body.NgayBatDauNamHoc || new Date(),
            SiSo: req.body.SiSo || 0,
            DanhSachMonHoc: chuanHoaDanhSachMonHoc(req.body.DanhSachMonHoc),
            TrangThai: 1
        };

        await LopHoc.create(data);
        res.redirect('/lophoc');
    } catch (err) {
        res.status(500).send('Loi khi tao lop moi: ' + err.message);
    }
});

router.get('/sua/:id', async function (req, res) {
    try {
        var data = await LopHoc.findById(req.params.id);
        if (!data) return res.redirect('/lophoc');

        var dsMonHoc = await MonHoc.find().sort({ TenMonHoc: 1 });
        res.render('lophoc_sua', {
            title: 'Cập Nhật Thông Tin Lớp',
            lop: data,
            dsMonHoc: dsMonHoc
        });
    } catch (err) {
        res.redirect('/lophoc');
    }
});

router.post('/sua/:id', async function (req, res) {
    try {
        const { MaLop, TenLop, NienKhoa, NgayBatDauNamHoc, SiSo, TrangThai } = req.body;

        await LopHoc.findByIdAndUpdate(req.params.id, {
            MaLop: MaLop,
            TenLop: TenLop,
            NienKhoa: NienKhoa,
            NgayBatDauNamHoc: NgayBatDauNamHoc,
            SiSo: SiSo,
            DanhSachMonHoc: chuanHoaDanhSachMonHoc(req.body.DanhSachMonHoc),
            TrangThai: Number(TrangThai)
        });

        res.redirect('/lophoc');
    } catch (err) {
        console.error(err);
        res.status(500).send('Có lỗi rồi.');
    }
});

router.get('/xoa/:id', async function (req, res) {
    try {
        await LopHoc.findByIdAndDelete(req.params.id);
        res.redirect('/lophoc');
    } catch (err) {
        res.status(500).send('Lỗi khi xóa lớp: ' + err.message);
    }
});

router.get('/trangthai/:id', async function (req, res) {
    try {
        var lop = await LopHoc.findById(req.params.id);
        var trangThaiMoi = lop.TrangThai == 1 ? 0 : 1;

        await LopHoc.findByIdAndUpdate(req.params.id, { TrangThai: trangThaiMoi });
        res.redirect('/lophoc');
    } catch (err) {
        res.redirect('/lophoc');
    }
});

module.exports = router;
