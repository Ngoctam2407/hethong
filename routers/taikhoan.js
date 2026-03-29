var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var TaiKhoan = require('../models/taikhoan');
var { requireAdmin } = require('./auth');
var LopHoc = require('../models/lophoc');
var SinhVien = require('../models/sinhvien');
var GiangVien = require('../models/giangvien');

function taoTienToMSSV(maLop) {
    const chunks = String(maLop || '').toUpperCase().match(/[A-Z]+/g) || [];
    if (chunks.length === 0) return 'SV';
    if (chunks.length === 1) return chunks[0].slice(0, 3);
    return `${chunks[0].charAt(0)}${chunks[chunks.length - 1]}`;
}

async function taoMSSVTuDong(IDLop, boQuaSinhVienId) {
    const lop = await LopHoc.findById(IDLop);
    if (!lop) throw new Error('Không tìm thấy lớp học để tạo MSSV tự động.');

    const tienTo = taoTienToMSSV(lop.MaLop);
    const dieuKien = {
        MSSV: new RegExp(`^${tienTo}\\d{3}$`)
    };

    if (boQuaSinhVienId) {
        dieuKien._id = { $ne: boQuaSinhVienId };
    }

    const dsSinhVien = await SinhVien.find(dieuKien).sort({ MSSV: 1 }).lean();
    let soThuTuMax = 0;

    dsSinhVien.forEach(function (sv) {
        const match = String(sv.MSSV || '').match(/(\d{3})$/);
        if (match) {
            soThuTuMax = Math.max(soThuTuMax, parseInt(match[1], 10));
        }
    });

    return `${tienTo}${String(soThuTuMax + 1).padStart(3, '0')}`;
}

router.use(requireAdmin);
// 1. GET: Danh sách (Địa chỉ: /taikhoan)
router.get('/', async (req, res) => {
    var tk = await TaiKhoan.find();
    res.render('taikhoan', { title: 'Danh sách tài khoản', taikhoan: tk });
});

// 2. GET: Form Thêm (Địa chỉ: /taikhoan/them)
router.get('/them', async (req, res) => {
    var dsLop = await LopHoc.find();
    res.render('taikhoan_them', { title: 'Thêm tài khoản', dsLop: dsLop });
});

// 3. POST: Xử lý Thêm
// 3. POST: Xử lý Thêm (Bản nâng cấp cho Tâm)
router.post('/them', async (req, res) => {
    try {
        const { HoVaTen, Email, TenDangNhap, MatKhau, QuyenHan, IDLop, MaGV } = req.body;

        if (QuyenHan === 'sinhvien') {
            if (!IDLop) {
                req.session.error = 'Sinh viên bắt buộc phải chọn lớp học.';
                return res.redirect('/taikhoan/them');
            }
        }

        const salt = bcrypt.genSaltSync(10);
        const data = {
            HoVaTen,
            Email,
            TenDangNhap,
            MatKhau: bcrypt.hashSync(MatKhau, salt),
            QuyenHan,
            TrangThai: 1
        };

        // Bước 1: Tạo tài khoản chính
        const tkMoi = await TaiKhoan.create(data);

        // Bước 2: Tạo bản ghi ở bảng phụ để "định danh" cho Hà/Đan
        if (QuyenHan === 'sinhvien') {
            const MSSV = await taoMSSVTuDong(IDLop);
            await SinhVien.create({
                IDTaiKhoan: tkMoi._id,
                MSSV,
                IDLop: IDLop // Đây chính là chìa khóa để lọc TKB sau này nè Tâm!
            });
        } else if (QuyenHan === 'giangvien') {
            await GiangVien.create({
                IDTaiKhoan: tkMoi._id,
                MaGV: MaGV || "GV000"
            });
        }

        req.session.success = `Đã tạo tài khoản cho ${HoVaTen} thành công!`;
        res.redirect('/taikhoan');
    } catch (err) {
        console.error(err);
        res.send("Lỗi khi thêm tài khoản rồi Tâm ơi: " + err.message);
    }
});

// 4. GET: Form Sửa (Địa chỉ: /taikhoan/sua/:id)
router.get('/sua/:id', async (req, res) => {
    var tk = await TaiKhoan.findById(req.params.id);
    var dsLop = await LopHoc.find();
    let detail = null; // Khai báo biến detail trước

    // Dùng tk.QuyenHan để kiểm tra
    if (tk.QuyenHan === 'sinhvien') {
        detail = await SinhVien.findOne({ IDTaiKhoan: tk._id });
    } else if (tk.QuyenHan === 'giangvien') {
        detail = await GiangVien.findOne({ IDTaiKhoan: tk._id });
    }
    res.render('taikhoan_sua', { title: 'Sửa tài khoản', tk: tk, dsLop: dsLop, detail: detail });

});

// 5. POST: Xử lý Cập nhật
router.post('/sua/:id', async (req, res) => {
    try {
        const { HoVaTen, Email, TenDangNhap, MatKhau, QuyenHan, IDLop, MaGV, LinhVuc, SoDienThoai } = req.body;

        if (QuyenHan === 'sinhvien') {
            if (!IDLop) {
                req.session.error = 'Sinh viên bắt buộc phải chọn lớp học.';
                return res.redirect('/taikhoan/sua/' + req.params.id);
            }
        }

        // A. Cập nhật bảng TaiKhoan (Chung)
        let updateData = { HoVaTen, Email, TenDangNhap, QuyenHan };

        // Nếu Tâm có nhập mật khẩu mới thì mới mã hóa và cập nhật
        if (MatKhau && MatKhau.trim() !== "" && MatKhau !== "********") {
            const salt = bcrypt.genSaltSync(10);
            updateData.MatKhau = bcrypt.hashSync(MatKhau, salt);
        }

        await TaiKhoan.findByIdAndUpdate(req.params.id, updateData);

        // B. Cập nhật bảng phụ (Riêng)
        if (QuyenHan === 'sinhvien') {
            const thongTinSVCu = await SinhVien.findOne({ IDTaiKhoan: req.params.id });
            const doiLop = !thongTinSVCu || String(thongTinSVCu.IDLop) !== String(IDLop);
            const MSSV = doiLop
                ? await taoMSSVTuDong(IDLop, thongTinSVCu ? thongTinSVCu._id : null)
                : thongTinSVCu.MSSV;

            await SinhVien.findOneAndUpdate(
                { IDTaiKhoan: req.params.id },
                { MSSV, IDLop },
                { upsert: true } // Nếu chưa có thì tạo mới luôn cho chắc
            );
        } else if (QuyenHan === 'giangvien') {
            await GiangVien.findOneAndUpdate(
                { IDTaiKhoan: req.params.id },
                { MaGV, LinhVuc, SoDienThoai },
                { upsert: true }
            );
        }

        res.redirect('/taikhoan');
    } catch (error) {
        console.error(error);
        res.send("Lỗi khi cập nhật tài khoản!");
    }
});

// 6. GET: Xóa (Địa chỉ: /taikhoan/xoa/:id)
router.get('/xoa/:id', async (req, res) => {
    await TaiKhoan.findByIdAndDelete(req.params.id);
    res.redirect('/taikhoan');
});

// 7. GET: Chuyển đổi trạng thái khóa/mở (Địa chỉ: /taikhoan/trangthai/:id)
router.get('/trangthai/:id', async (req, res) => {
    try {
        // 1. Tìm tài khoản hiện tại
        var tk = await TaiKhoan.findById(req.params.id);

        // 2. Đảo ngược trạng thái (Nếu 1 thì thành 0, nếu 0 thì thành 1)
        var trangThaiMoi = (tk.TrangThai == 1) ? 0 : 1;

        // 3. Cập nhật vào Database
        await TaiKhoan.findByIdAndUpdate(req.params.id, { TrangThai: trangThaiMoi });

        // 4. Thông báo cho Tâm biết nè
        req.session.success = "Đã cập nhật trạng thái cho " + tk.HoVaTen + " thành công!";
        res.redirect('/taikhoan');
    } catch (err) {
        req.session.error = "Lỗi khi đổi trạng thái: " + err.message;
        res.redirect('/taikhoan');
    }
});


module.exports = router;
