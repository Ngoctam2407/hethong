var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var TaiKhoan = require('../models/taikhoan');
var PhongHoc = require('../models/phonghoc');
var LopHoc = require('../models/lophoc');
var SinhVien = require('../models/sinhvien');
var GiangVien = require('../models/giangvien');
var TKB = require('../models/tkb');

// GET: Trang chủ
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;

        // 1. ĐỊNH NGHĨA KHUNG GIỜ TRƯỚC (Để máy tính biết tiết mấy)
        const khungGioHoc = [
            { tiet: 1, batDau: "07:00", ketThuc: "07:45" },
            { tiet: 2, batDau: "07:45", ketThuc: "08:30" },
            { tiet: 3, batDau: "08:30", ketThuc: "09:15" },
            { tiet: 4, batDau: "09:15", ketThuc: "10:00" },
            { tiet: 5, batDau: "10:00", ketThuc: "10:45" },
            { tiet: 6, batDau: "13:00", ketThuc: "13:45" },
            { tiet: 7, batDau: "13:45", ketThuc: "14:30" },
            { tiet: 8, batDau: "14:30", ketThuc: "15:15" },
            { tiet: 9, batDau: "15:15", ketThuc: "16:00" },
            { tiet: 10, batDau: "16:00", ketThuc: "16:45" },
            { tiet: 11, batDau: "18:00", ketThuc: "18:45" },
            { tiet: 12, batDau: "18:45", ketThuc: "19:30" }
        ];

        // 2. XÁC ĐỊNH THỜI GIAN HIỆN TẠI
        const gioHienTai = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        const tietHienTai = khungGioHoc.find(g => gioHienTai >= g.batDau && gioHienTai < g.ketThuc)?.tiet;
        const dsThu = ["Chủ Nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
        const thuHomNay = dsThu[new Date().getDay()];

        // 3. TRUY VẤN DỮ LIỆU THỐNG KÊ (Dùng await để đợi lấy xong số liệu)
        let lichDangHoc = [];
        if (tietHienTai) {
            lichDangHoc = await TKB.find({
                TrangThai: 'da-duyet',
                Thu: thuHomNay,
                TietBatDau: { $lte: tietHienTai },
                TietKetThuc: { $gte: tietHienTai }
            });
        }

        const soLopDangHoc = lichDangHoc.length;
        const tongPhong = await PhongHoc.countDocuments();
        const tongGV = await TaiKhoan.countDocuments({ QuyenHan: 'giangvien' });

        // 4. PHÂN LUỒNG HIỂN THỊ DANH SÁCH
        let dsLich = [];
        let dsTaiKhoan = [];

        if (user) {
            if (user.QuyenHan === 'admin') {
                dsLich = await TKB.find().populate('MonHoc PhongHoc GiangVien').sort({ _id: -1 }).limit(5);
                dsTaiKhoan = await TaiKhoan.find();
            } else if (user.QuyenHan === 'giangvien') {
                dsLich = await TKB.find({ GiangVien: user._id }).populate('MonHoc PhongHoc').sort({ Thu: 1 });
            } else if (user.QuyenHan === 'sinhvien') {
                dsLich = await TKB.find({ LopHoc: user.LopHoc }).populate('MonHoc PhongHoc GiangVien').sort({ Thu: 1 });
            }
        }

        // 5. RENDER DỮ LIỆU SANG EJS
        res.render('index', {
            title: 'Trang chủ Edu KT',
            path: '/',
            dsTaiKhoan: dsTaiKhoan,
            dsLich: dsLich,
            user: user,
            thongKeDashboard: [
                soLopDangHoc,
                tongPhong - soLopDangHoc,
                tongGV - soLopDangHoc
            ],
            isLoggedIn: !!user
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi phân luồng dữ liệu rồi Tâm ơi! Kiểm tra Terminal nhé.");
    }
});

// GET: Lỗi
router.get('/error', async (req, res) => {
    res.render('error', {
        title: 'Lỗi'
    });
});
// GET: Thành công
router.get('/success', async (req, res) => {
    res.render('success', {
        title: 'Hoàn thành'
    });
});

// GET: Hiện trang đăng nhập
router.get('/dangnhap', async (req, res) => {
    res.render('dangnhap', {
        title: 'Đăng nhập'
    });
});

// POST: Xử lý Đăng nhập
router.post('/dangnhap', async (req, res) => {
    try {
        // Kiểm tra xem đã đăng nhập chưa
        if (req.session.user) {
            req.session.error = 'Tâm ơi, em đang ở trong hệ thống rồi mà!';
            return res.redirect('/');
        }

        const { TenDangNhap, MatKhau } = req.body;
        const taikhoan = await TaiKhoan.findOne({ TenDangNhap: TenDangNhap });

        if (taikhoan) {
            // So sánh mật khẩu
            if (bcrypt.compareSync(MatKhau, taikhoan.MatKhau)) {
                if (taikhoan.TrangThai == 0) {
                    req.session.error = 'Tài khoản của Tâm đang tạm khóa nhé.';
                    return res.redirect('/dangnhap');
                } else {
                    // LƯU SESSION
                    req.session.user = taikhoan;

                    // --- PHÂN LUỒNG TÁC NHÂN CHO ADMIN TÂM ---
                    if (taikhoan.QuyenHan === 'admin') {
                        req.session.success = 'Chào mừng Admin Tâm quay lại vương quốc! ';
                        return res.redirect('/taikhoan'); // Admin vào thẳng trang Quản lý thành viên

                    } else if (taikhoan.QuyenHan === 'giangvien') {
                        req.session.success = 'Chào Giảng viên! Chúc thầy/cô có buổi dạy tốt.';
                        return res.redirect('/'); // Giảng viên vào trang Quản lý phòng học để xem lịch dạy

                    } else {
                        req.session.success = 'Chào bạn sinh viên! Cố gắng học tập nhé.';
                        return res.redirect('/'); // Sinh viên thì về trang chủ (nơi hiện danh sách phòng học)
                    }
                }

            } else {
                req.session.error = 'Mật khẩu hổng đúng, em kiểm tra lại nha.';
                return res.redirect('/dangnhap');
            }
        } else {
            req.session.error = 'Tên đăng nhập này anh chưa thấy trong máy Tâm ơi.';
            return res.redirect('/dangnhap');
        }
    } catch (err) {
        console.error(err);
        req.session.error = 'Có chút lỗi kỹ thuật, Tâm thử lại nhé!';
        res.redirect('/dangnhap');
    }
});

// GET: Đăng xuất
router.get('/dangxuat', (req, res) => {
    req.session.destroy((err) => {
        res.redirect('/');
    });
});



module.exports = router;