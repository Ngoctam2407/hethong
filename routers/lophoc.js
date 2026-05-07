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

// Lấy giá trị từ một dòng Excel theo tên cột đã quy ước trong file mẫu.
function layGiaTriDong(dong, truong) {
    return dong[truong] || dong[truong.toLowerCase()] || '';
}

// Chuẩn hóa danh sách môn học từ form: có thể là 1 ID hoặc nhiều ID.
function chuanHoaDanhSachMonHoc(duLieu) {
    if (!duLieu) return [];
    if (Array.isArray(duLieu)) return duLieu.filter(Boolean);
    return [duLieu].filter(Boolean);
}

router.use(requireAdmin);

// GET: Danh sách lớp học và các môn đã gán cho từng lớp.
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

// POST: Import lớp học từ Excel, tự liên kết môn học theo mã môn hoặc tên môn.
router.post('/import', xuLyUploadExcel, async function (req, res) {
    try {
        if (!req.file) {
            req.session.error = 'Bạn cần chọn file Excel trước khi import.';
            return res.redirect('/lophoc');
        }

        const rows = readRowsFromExcel(req.file.buffer);
        if (!rows.length) {
            req.session.error = 'File Excel không có dòng dữ liệu nào.';
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
                NgayKetThucNamHoc: layGiaTriDong(row, 'NgayKetThucNamHoc') ? new Date(layGiaTriDong(row, 'NgayKetThucNamHoc')) : null,
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

        req.session.success = 'Import lớp học thành công: ' + taoMoi + ' bản ghi mới, ' + capNhat + ' bản ghi cập nhật.';
        res.redirect('/lophoc');
    } catch (err) {
        console.error(err);
        req.session.error = 'Lỗi import lớp học: ' + err.message;
        res.redirect('/lophoc');
    }
});

// GET: Xuất danh sách lớp học ra file Excel.
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
                NgayBatDau: lop.NgayBatDauNamHoc ? new Date(lop.NgayBatDauNamHoc).toLocaleDateString('vi-VN') : '',
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
        req.session.error = 'Không thể export lớp học: ' + err.message;
        res.redirect('/lophoc');
    }
});

// GET: Form tạo lớp học mới.
router.get('/them', async function (req, res) {
    try {
        const dsMonHoc = await MonHoc.find().sort({ TenMonHoc: 1 });
        res.render('lophoc_them', {
            title: 'Tạo Lớp Học Mới',
            dsMonHoc: dsMonHoc
        });
    } catch (err) {
        res.status(500).send('Lỗi tải môn học: ' + err.message);
    }
});

// POST: Lưu lớp học mới và danh sách môn học được chọn.
router.post('/them', async function (req, res) {
    try {
        if (!req.body || !req.body.MaLop || !req.body.TenLop) {
            return res.send('Bạn cần nhập MaLop và TenLop.');
        }

        var data = {
            MaLop: req.body.MaLop,
            TenLop: req.body.TenLop,
            NienKhoa: req.body.NienKhoa,
            NgayBatDauNamHoc: req.body.NgayBatDauNamHoc || new Date(),
            NgayKetThucNamHoc: req.body.NgayKetThucNamHoc || null,
            SiSo: req.body.SiSo || 0,
            DanhSachMonHoc: chuanHoaDanhSachMonHoc(req.body.DanhSachMonHoc),
            TrangThai: 1
        };

        await LopHoc.create(data);
        res.redirect('/lophoc');
    } catch (err) {
        res.status(500).send('Lỗi khi tạo lớp mới: ' + err.message);
    }
});

// GET: Form cập nhật lớp học.
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

// POST: Cập nhật thông tin lớp học và danh sách môn học ràng buộc.
router.post('/sua/:id', async function (req, res) {
    try {
        const { MaLop, TenLop, NienKhoa, NgayBatDauNamHoc, NgayKetThucNamHoc, SiSo, TrangThai } = req.body;

        await LopHoc.findByIdAndUpdate(req.params.id, {
            MaLop: MaLop,
            TenLop: TenLop,
            NienKhoa: NienKhoa,
            NgayBatDauNamHoc: NgayBatDauNamHoc,
            NgayKetThucNamHoc: NgayKetThucNamHoc,
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

// API: Lấy chi tiết lớp học kèm danh sách môn học đã ràng buộc.
router.get('/api/:id', async (req, res) => {
    try {
        const lop = await LopHoc.findById(req.params.id).populate('DanhSachMonHoc');
        if (!lop) return res.status(404).json({ message: 'Không tìm thấy lớp học.' });
        res.json(lop);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Lỗi máy chủ khi lấy dữ liệu lớp học.' });
    }
});

// GET: Xóa lớp học.
router.get('/xoa/:id', async function (req, res) {
    try {
        await LopHoc.findByIdAndDelete(req.params.id);
        res.redirect('/lophoc');
    } catch (err) {
        res.status(500).send('Lỗi khi xóa lớp: ' + err.message);
    }
});

// GET: Đảo trạng thái hoạt động/tạm ngưng của lớp học.
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
