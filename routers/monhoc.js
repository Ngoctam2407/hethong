const express = require('express');
const router = express.Router();
const MonHoc = require('../models/monhoc');
var { requireAdmin } = require('./auth');
const { upload, readRowsFromExcel, buildWorkbook, sendWorkbook } = require('../utils/excel');

function xuLyUploadExcel(req, res, next) {
    upload.single('excelFile')(req, res, function (err) {
        if (err) {
            req.session.error = err.message;
            return res.redirect('/monhoc');
        }
        next();
    });
}

// Lấy giá trị từ file Excel theo tên cột, hỗ trợ cả trường hợp cột viết thường.
function layGiaTriDong(dong, truong) {
    return dong[truong] || dong[truong.toLowerCase()] || '';
}

router.use(requireAdmin);
// GET: Trang danh sách môn học.
router.get('/', async (req, res) => {
    const dsMonHoc = await MonHoc.find();
    res.render('monhoc', { title: 'Quản lý môn học', dsMonHoc });
});

// POST: Import môn học từ Excel, tự cập nhật nếu trùng mã môn.
router.post('/import', xuLyUploadExcel, async (req, res) => {
    try {
        if (!req.file) {
            req.session.error = 'Bạn cần chọn file Excel trước khi import.';
            return res.redirect('/monhoc');
        }

        const rows = readRowsFromExcel(req.file.buffer);
        if (!rows.length) {
            req.session.error = 'File Excel không có dòng dữ liệu nào.';
            return res.redirect('/monhoc');
        }

        let taoMoi = 0;
        let capNhat = 0;

        for (const row of rows) {
            const MaMonHoc = String(layGiaTriDong(row, 'MaMonHoc')).trim();
            const TenMonHoc = String(layGiaTriDong(row, 'TenMonHoc')).trim();

            if (!MaMonHoc || !TenMonHoc) {
                continue;
            }

            const duLieu = {
                MaMonHoc,
                TenMonHoc,
                TongSoTiet: Number(layGiaTriDong(row, 'TongSoTiet')) || 0,
                MoTa: String(layGiaTriDong(row, 'MoTa')).trim()
            };

            const monHocCu = await MonHoc.findOne({ MaMonHoc: MaMonHoc });
            if (monHocCu) {
                await MonHoc.findByIdAndUpdate(monHocCu._id, duLieu);
                capNhat++;
            } else {
                await MonHoc.create(duLieu);
                taoMoi++;
            }
        }

        req.session.success = `Import môn học thành công: ${taoMoi} bản ghi mới, ${capNhat} bản ghi cập nhật.`;
        res.redirect('/monhoc');
    } catch (err) {
        console.error(err);
        req.session.error = 'Lỗi import môn học: ' + err.message;
        res.redirect('/monhoc');
    }
});

// GET: Xuất toàn bộ danh sách môn học ra file Excel.
router.get('/export', async (req, res) => {
    try {
        const dsMonHoc = await MonHoc.find().sort({ MaMonHoc: 1 }).lean();
        const rows = dsMonHoc.map(function (mon) {
            return {
                MaMonHoc: mon.MaMonHoc,
                TenMonHoc: mon.TenMonHoc,
                TongSoTiet: mon.TongSoTiet || 0,
                MoTa: mon.MoTa || ''
            };
        });

        const workbook = buildWorkbook('MonHoc', rows);
        sendWorkbook(res, workbook, 'monhoc.xlsx');
    } catch (err) {
        console.error(err);
        req.session.error = 'Không thể export môn học: ' + err.message;
        res.redirect('/monhoc');
    }
});

// GET: Form thêm môn học.
router.get('/them', (req, res) => {
    res.render('monhoc_them', { title: 'Thêm môn học mới' });
});

// POST: Xử lý thêm môn học mới.
router.post('/them', async (req, res) => {
    try {
        const { TenMonHoc, MaMonHoc, TongSoTiet, MoTa } = req.body;
        const monMoi = new MonHoc({ TenMonHoc, MaMonHoc, TongSoTiet: Number(TongSoTiet) || 0, MoTa });
        await monMoi.save();
        res.redirect('/monhoc');
    } catch (err) {
        res.send("Có lỗi xảy ra rồi Tâm ơi: " + err);
    }
});

// GET: Form sửa môn học.
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

// POST: Xử lý sửa môn học.
router.post('/sua/:id', async (req, res) => {
    try {
        const { TenMonHoc, MaMonHoc, TongSoTiet, MoTa } = req.body;
        await MonHoc.findByIdAndUpdate(req.params.id, { TenMonHoc, MaMonHoc, TongSoTiet: Number(TongSoTiet) || 0, MoTa });
        res.redirect('/monhoc');
    } catch (err) {
        res.send("Lỗi cập nhật: " + err);
    }
});

// GET: Xóa môn học.
router.get('/xoa/:id', async (req, res) => {
    try {
        await MonHoc.findByIdAndDelete(req.params.id);
        res.redirect('/monhoc');
    } catch (err) {
        res.send("Lỗi xóa: " + err);
    }
});

module.exports = router;
