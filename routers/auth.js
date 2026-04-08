var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var TaiKhoan = require('../models/taikhoan');
var SinhVien = require('../models/sinhvien');
var GiangVien = require('../models/giangvien');
var { normalizeSubscription, sendNotification } = require('../utils/push');

async function taoDuLieuSession(taikhoan) {
    let userSession = taikhoan.toObject ? taikhoan.toObject() : { ...taikhoan };

    if (taikhoan.QuyenHan === 'sinhvien') {
        const sv = await SinhVien.findOne({ IDTaiKhoan: taikhoan._id }).populate('IDLop', 'TenLop');
        if (sv) {
            userSession.LopHoc = sv.IDLop ? sv.IDLop._id : sv.IDLop;
            userSession.TenLopHienThi = sv.IDLop ? sv.IDLop.TenLop : '';
        }
    } else if (taikhoan.QuyenHan === 'giangvien') {
        userSession.GiangVien = taikhoan._id;
    }

    return userSession;
}



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
                    // LƯU SESSION có kèm dữ liệu phụ để các trang phân luồng ổn định hơn
                    req.session.user = await taoDuLieuSession(taikhoan);

                    // --- PHÂN LUỒNG TÁC NHÂN CHO ADMIN TÂM ---
                    if (taikhoan.QuyenHan === 'admin') {
                        req.session.success = 'Chào mừng Admin ! ';
                        return res.redirect('/');

                    } else if (taikhoan.QuyenHan === 'giangvien') {
                        req.session.success = 'Chào Giảng viên! Chúc thầy/cô có buổi dạy tốt.';
                        return res.redirect('/');

                    } else {
                        req.session.success = 'Chào bạn sinh viên! Cố gắng học tập nhé.';
                        return res.redirect('/'); // Sinh viên thì về trang chủ (nơi hiện danh sách phòng học)
                    }
                }

            } else {
                req.session.error = 'Mật khẩu không đúng, kiểm tra lại.';
                return res.redirect('/dangnhap');
            }
        } else {
            req.session.error = 'Tên đăng nhập này không tồn tại trong máy .';
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

router.get('/hoso', requireLogin, async (req, res) => {
    try {
        const tk = await TaiKhoan.findById(req.session.user._id);
        if (!tk) {
            req.session.error = 'Không tìm thấy tài khoản của bạn.';
            return res.redirect('/auth/dangnhap');
        }

        if (tk.QuyenHan === 'admin') {
            req.session.error = 'Trang này chỉ dành cho sinh viên và giảng viên.';
            return res.redirect('/taikhoan');
        }

        let detail = null;
        if (tk.QuyenHan === 'sinhvien') {
            detail = await SinhVien.findOne({ IDTaiKhoan: tk._id }).populate('IDLop', 'MaLop TenLop');
        } else if (tk.QuyenHan === 'giangvien') {
            detail = await GiangVien.findOne({ IDTaiKhoan: tk._id });
        }

        res.render('hoso_canhan', {
            title: 'Thông tin cá nhân',
            tk,
            detail
        });
    } catch (err) {
        console.error(err);
        req.session.error = 'Không tải được hồ sơ cá nhân.';
        res.redirect('/');
    }
});

router.post('/hoso', requireLogin, async (req, res) => {
    try {
        const tk = await TaiKhoan.findById(req.session.user._id);
        if (!tk) {
            req.session.error = 'Không tìm thấy tài khoản của bạn.';
            return res.redirect('/auth/dangnhap');
        }

        if (tk.QuyenHan === 'admin') {
            req.session.error = 'Trang này chỉ dành cho sinh viên và giảng viên.';
            return res.redirect('/taikhoan');
        }

        const { HoVaTen, Email, TenDangNhap, MatKhau, SoDienThoai, NgaySinh, LinhVuc, ChuyenNganh } = req.body;
        let updateData = { HoVaTen, Email, TenDangNhap };

        if (MatKhau && MatKhau.trim() !== '') {
            const salt = bcrypt.genSaltSync(10);
            updateData.MatKhau = bcrypt.hashSync(MatKhau, salt);
        }

        await TaiKhoan.findByIdAndUpdate(tk._id, updateData);

        if (tk.QuyenHan === 'sinhvien') {
            await SinhVien.findOneAndUpdate(
                { IDTaiKhoan: tk._id },
                { SoDienThoai, NgaySinh: NgaySinh || null },
                { upsert: true }
            );
        } else if (tk.QuyenHan === 'giangvien') {
            await GiangVien.findOneAndUpdate(
                { IDTaiKhoan: tk._id },
                { SoDienThoai, LinhVuc, ChuyenNganh },
                { upsert: true }
            );
        }

        const taiKhoanMoi = await TaiKhoan.findById(tk._id);
        req.session.user = await taoDuLieuSession(taiKhoanMoi);
        req.session.success = 'Đã cập nhật thông tin cá nhân thành công.';
        res.redirect('/auth/hoso');
    } catch (err) {
        console.error(err);
        req.session.error = 'Lỗi khi cập nhật thông tin cá nhân: ' + err.message;
        res.redirect('/auth/hoso');
    }
});

router.get('/push/config', requireLogin, async function (req, res) {
    res.json({
        ok: true,
        publicKey: req.app.locals.webPushPublicKey || res.locals.webPushPublicKey
    });
});

router.post('/push/subscribe', requireLogin, async function (req, res) {
    try {
        const subscription = normalizeSubscription(req.body.subscription);
        if (!subscription) {
            return res.status(400).json({ ok: false, message: 'Subscription khong hop le.' });
        }

        const taiKhoan = await TaiKhoan.findById(req.session.user._id);
        if (!taiKhoan) {
            return res.status(404).json({ ok: false, message: 'Khong tim thay tai khoan.' });
        }

        const dsCu = Array.isArray(taiKhoan.PushSubscriptions) ? taiKhoan.PushSubscriptions : [];
        const daTonTai = dsCu.some(function (item) {
            return item && item.endpoint === subscription.endpoint;
        });

        if (!daTonTai) {
            dsCu.push(subscription);
            taiKhoan.PushSubscriptions = dsCu;
            await taiKhoan.save();
        }

        res.json({ ok: true, subscribed: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Khong luu duoc dang ky thong bao.' });
    }
});

router.post('/push/unsubscribe', requireLogin, async function (req, res) {
    try {
        const endpoint = String(req.body.endpoint || '').trim();
        const taiKhoan = await TaiKhoan.findById(req.session.user._id);
        if (!taiKhoan) {
            return res.status(404).json({ ok: false, message: 'Khong tim thay tai khoan.' });
        }

        taiKhoan.PushSubscriptions = (taiKhoan.PushSubscriptions || []).filter(function (item) {
            return item && item.endpoint !== endpoint;
        });
        await taiKhoan.save();

        res.json({ ok: true, subscribed: false });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Khong huy duoc dang ky thong bao.' });
    }
});

router.post('/push/test', requireLogin, async function (req, res) {
    try {
        const taiKhoan = await TaiKhoan.findById(req.session.user._id);
        if (!taiKhoan) {
            return res.status(404).json({ ok: false, message: 'Khong tim thay tai khoan.' });
        }

        const subscriptions = Array.isArray(taiKhoan.PushSubscriptions) ? taiKhoan.PushSubscriptions : [];
        if (!subscriptions.length) {
            return res.status(400).json({ ok: false, message: 'Ban chua bat thong bao day tren trinh duyet nay.' });
        }

        const payload = {
            title: 'Thong bao thu nghiem',
            body: 'He thong KT da gui thong bao day thanh cong.',
            url: '/',
            icon: '/images/logo-kt.png',
            badge: '/images/logo-kt.png'
        };

        const hopLe = [];
        for (const subscription of subscriptions) {
            try {
                await sendNotification(subscription, payload);
                hopLe.push(subscription);
            } catch (err) {
                const maLoi = err && (err.statusCode || err.code);
                if (maLoi !== 404 && maLoi !== 410) {
                    console.error(err);
                    hopLe.push(subscription);
                }
            }
        }

        if (hopLe.length !== subscriptions.length) {
            taiKhoan.PushSubscriptions = hopLe;
            await taiKhoan.save();
        }

        if (!hopLe.length) {
            return res.status(400).json({ ok: false, message: 'Dang ky thong bao da het han. Ban hay bat lai thong bao.' });
        }

        res.json({ ok: true, message: 'Da gui thong bao thu nghiem.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Khong gui duoc thong bao thu nghiem.' });
    }
});


function requireAdmin(req, res, next) {

    // chưa đăng nhập
    if (!req.session.user) {
        req.session.error = "Bạn cần đăng nhập trước!";
        return res.redirect('/dangnhap');
    }

    // không phải admin
    if (req.session.user.QuyenHan !== 'admin') {
        req.session.error = "Bạn không có quyền truy cập trang này!";
        return res.redirect('/');
    }


    next();
}

function requireLogin(req, res, next) {
    if (!req.session.user) {
        req.session.error = "Bạn cần đăng nhập trước!";
        return res.redirect('/auth/dangnhap');
    }

    next();
}

module.exports = router;
module.exports.requireAdmin = requireAdmin; // Xuất thêm hàm middleware để kiểm tra quyền admin
module.exports.requireLogin = requireLogin;
