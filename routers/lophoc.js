var express = require('express');
var router = express.Router();
var LopHoc = require('../models/lophoc'); // Model này Tâm nhớ định nghĩa MaLop, TenLop, NienKhoa, SiSo nhé
var { requireAdmin } = require('./auth');
var TaiKhoan = require('../models/taikhoan');
var SinhVien = require('../models/sinhvien');
var GiangVien = require('../models/giangvien');
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

// Chỉ cho phép Admin truy cập để quản lý lớp học thôi Tâm nhé
router.use(requireAdmin);

// 1. GET: Danh sách lớp học (Địa chỉ: /lophoc)
router.get('/', async (req, res) => {
    try {
        // Tìm tất cả các lớp học và sắp xếp theo mã lớp cho Tâm dễ nhìn nè
        var dsLop = await LopHoc.find().sort({ MaLop: 1 });
        res.render('lophoc', {
            title: 'Quản Lý Lớp Học',
            dsLopHoc: dsLop // Truyền vào đúng tên biến dsLopHoc mà file .ejs đang dùng
        });
    } catch (err) {
        console.error("Lỗi rồi Tâm ơi: ", err);
        res.status(500).send("Có lỗi xảy ra khi lấy danh sách lớp học.");
    }
});

router.post('/import', xuLyUploadExcel, async (req, res) => {
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

        let taoMoi = 0;
        let capNhat = 0;

        for (const row of rows) {
            const MaLop = String(layGiaTriDong(row, 'MaLop')).trim();
            const TenLop = String(layGiaTriDong(row, 'TenLop')).trim();

            if (!MaLop || !TenLop) {
                continue;
            }

            const duLieu = {
                MaLop,
                TenLop,
                NienKhoa: String(layGiaTriDong(row, 'NienKhoa')).trim(),
                SiSo: toNumber(layGiaTriDong(row, 'SiSo'), 0),
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

        req.session.success = `Import lop hoc thanh cong: ${taoMoi} ban ghi moi, ${capNhat} ban ghi cap nhat.`;
        res.redirect('/lophoc');
    } catch (err) {
        console.error(err);
        req.session.error = 'Loi import lop hoc: ' + err.message;
        res.redirect('/lophoc');
    }
});

router.get('/export', async (req, res) => {
    try {
        const dsLop = await LopHoc.find().sort({ MaLop: 1 }).lean();
        const rows = dsLop.map(function (lop) {
            return {
                MaLop: lop.MaLop,
                TenLop: lop.TenLop,
                NienKhoa: lop.NienKhoa || '',
                SiSo: lop.SiSo || 0,
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

// 2. GET: Form Thêm lớp học (Địa chỉ: /lophoc/them)
router.get('/them', (req, res) => {
    res.render('lophoc_them', { title: 'Tạo Lớp Học Mới' });
});

// 3. POST: Xử lý Thêm lớp học
router.post('/them', async (req, res) => {
    try {
        if (!req.body || !req.body.MaLop || !req.body.TenLop) {
            return res.send("Tâm ơi, em đừng quên nhập Mã lớp và Tên lớp nha!");
        }

        var data = {
            MaLop: req.body.MaLop,
            TenLop: req.body.TenLop,
            NienKhoa: req.body.NienKhoa,
            SiSo: req.body.SiSo || 0,
            TrangThai: 1 // Mặc định lớp mới tạo là đang hoạt động
        };

        await LopHoc.create(data);
        res.redirect('/lophoc');
    } catch (err) {
        res.status(500).send("Lỗi khi tạo lớp mới: " + err.message);
    }
});

// 4. GET: Form Sửa lớp học (Địa chỉ: /lophoc/sua/:id)
router.get('/sua/:id', async (req, res) => {
    try {
        var data = await LopHoc.findById(req.params.id);
        if (!data) return res.redirect('/lophoc');

        res.render('lophoc_sua', { title: 'Cập nhật thông tin lớp', lop: data });
    } catch (err) {
        res.redirect('/lophoc');
    }
});

// 5. POST: Xử lý Cập nhật lớp học
router.post('/sua/:id', async (req, res) => {
    try {
        const { MaLop, TenLop, NienKhoa, SiSo, TrangThai } = req.body;

        await LopHoc.findByIdAndUpdate(req.params.id, {
            MaLop,
            TenLop,
            NienKhoa,
            SiSo,
            TrangThai: Number(TrangThai)
        });

        res.redirect('/lophoc');
    } // <--- Phải có dấu đóng ngoặc của khối try ở đây
    catch (err) { // Dòng 73 của Tâm đang nằm ở đây nè
        console.error(err);
        res.status(500).send("Có lỗi rồi Tâm ơi!");
    }
}); // <--- Đừng quên đóng ngoặc của router.post nữa nhé

// 6. GET: Xóa lớp học (Địa chỉ: /lophoc/xoa/:id)
router.get('/xoa/:id', async (req, res) => {
    try {
        await LopHoc.findByIdAndDelete(req.params.id);
        res.redirect('/lophoc');
    } catch (err) {
        res.status(500).send("Lỗi khi xóa lớp: " + err.message);
    }
});

// 7. GET: Chuyển đổi trạng thái lớp (Đang mở / Đã đóng)
router.get('/trangthai/:id', async (req, res) => {
    try {
        var lop = await LopHoc.findById(req.params.id);
        // Nếu TrangThai là 1 thì chuyển về 0, và ngược lại
        var trangThaiMoi = (lop.TrangThai == 1) ? 0 : 1;

        await LopHoc.findByIdAndUpdate(req.params.id, { TrangThai: trangThaiMoi });
        res.redirect('/lophoc');
    } catch (err) {
        res.redirect('/lophoc');
    }
});

module.exports = router;
