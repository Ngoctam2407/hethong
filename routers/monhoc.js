const express = require('express');
const router = express.Router();
const MonHoc = require('../models/monhoc'); // Model mà chúng mình vừa bàn ở trên nè
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

function layGiaTriDong(dong, truong) {
    return dong[truong] || dong[truong.toLowerCase()] || '';
}

router.use(requireAdmin);
// 1. Trang danh sách môn học
router.get('/', async (req, res) => {
    const dsMonHoc = await MonHoc.find();
    res.render('monhoc', { title: 'Quản lý môn học', dsMonHoc });
});

router.post('/import', xuLyUploadExcel, async (req, res) => {
    try {
        if (!req.file) {
            req.session.error = 'Ban can chon file Excel truoc khi import.';
            return res.redirect('/monhoc');
        }

        const rows = readRowsFromExcel(req.file.buffer);
        if (!rows.length) {
            req.session.error = 'File Excel khong co dong du lieu nao.';
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

        req.session.success = `Import mon hoc thanh cong: ${taoMoi} ban ghi moi, ${capNhat} ban ghi cap nhat.`;
        res.redirect('/monhoc');
    } catch (err) {
        console.error(err);
        req.session.error = 'Loi import mon hoc: ' + err.message;
        res.redirect('/monhoc');
    }
});

router.get('/export', async (req, res) => {
    try {
        const dsMonHoc = await MonHoc.find().sort({ MaMonHoc: 1 }).lean();
        const rows = dsMonHoc.map(function (mon) {
            return {
                MaMonHoc: mon.MaMonHoc,
                TenMonHoc: mon.TenMonHoc,
                MoTa: mon.MoTa || ''
            };
        });

        const workbook = buildWorkbook('MonHoc', rows);
        sendWorkbook(res, workbook, 'monhoc.xlsx');
    } catch (err) {
        console.error(err);
        req.session.error = 'Khong the export mon hoc: ' + err.message;
        res.redirect('/monhoc');
    }
});

// 2. Trang thêm môn học
router.get('/them', (req, res) => {
    res.render('monhoc_them', { title: 'Thêm môn học mới' });
});

// 3. Xử lý thêm môn học mới
router.post('/them', async (req, res) => {
    try {
        const { TenMonHoc, MaMonHoc, MoTa } = req.body;
        const monMoi = new MonHoc({ TenMonHoc, MaMonHoc, MoTa });
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
        const { TenMonHoc, MaMonHoc, MoTa } = req.body;
        await MonHoc.findByIdAndUpdate(req.params.id, { TenMonHoc, MaMonHoc, MoTa });
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
