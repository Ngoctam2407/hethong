var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var TaiKhoan = require('../models/taikhoan');

// GET: Trang chủ
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;
        let dsLich = [];

        if (user) {
            // TÙY THEO QUYỀN HẠN MÀ LẤY DỮ LIỆU KHÁC NHAU
            if (user.QuyenHan === 'admin') {
                // Admin: Xem 5 lịch học mới nhất của toàn hệ thống
                dsLich = await TKB.find().populate('MonHoc PhongHoc GiangVien').sort({ _id: -1 }).limit(5);

            } else if (user.QuyenHan === 'giangvien') {
                // Giảng viên: Chỉ xem những lịch mà mình đi dạy
                dsLich = await TKB.find({ GiangVien: user._id }).populate('MonHoc PhongHoc').sort({ Thu: 1 });

            } else if (user.QuyenHan === 'sinhvien') {
                // Sinh viên: Xem lịch của lớp mà sinh viên đó thuộc về
                // (Giả sử trong model TaiKhoan của sinh viên có lưu field LopHoc)
                dsLich = await TKB.find({ LopHoc: user.LopHoc }).populate('MonHoc PhongHoc GiangVien').sort({ Thu: 1 });
            }
        }

        res.render('index', {
            title: 'Trang chủ Edu KT',
            dsLich: dsLich,
            user: user, // Gửi user sang để EJS kiểm tra quyền
            isLoggedIn: !!user
        });
    } catch (err) {
        res.status(500).send("Lỗi phân luồng dữ liệu rồi Tâm ơi!");
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