var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var TaiKhoan = require('../models/taikhoan');
var PhongHoc = require('../models/phonghoc');
var LopHoc = require('../models/lophoc');
var SinhVien = require('../models/sinhvien');
var GiangVien = require('../models/giangvien');
var TKB = require('../models/tkb');
var { getFormattedNgayHoc } = require('../utils/date_helpers'); // Import hàm từ tiện ích mới

// GET: Trang chủ
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;
        const tuKhoaTraCuu = String(req.query.q || '').trim();

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

        // 4. PHÂN LUỒNG HIỂN THỊ DỮ LIỆU
        let dsLich = [];
        let dsTaiKhoan = [];
        let ketQuaTraCuu = null;
        if (user) {
            const formatLich = async (list) => { // Đổi thành async function
                return await Promise.all(list.map(async item => {
                    const ngayHocHienThi = await getFormattedNgayHoc(item);
                    return { ...item.toObject(), NgayHocHienThi: ngayHocHienThi };
                }));
            };

            if (user.QuyenHan === 'admin') {
                const rawLich = await TKB.find().populate('MonHoc PhongHoc GiangVien LopHoc').sort({ _id: -1 }).limit(5); // Thêm populate LopHoc
                dsLich = await formatLich(rawLich); // Đợi kết quả từ async map
                dsTaiKhoan = await TaiKhoan.find();
            } else if (user.QuyenHan === 'giangvien') {
                const rawLich = await TKB.find({ GiangVien: user._id }).populate('MonHoc PhongHoc LopHoc').sort({ Thu: 1 }); // Thêm populate LopHoc
                dsLich = await formatLich(rawLich); // Đợi kết quả từ async map
            } else if (user.QuyenHan === 'sinhvien') {
                const rawLich = await TKB.find({ LopHoc: user.LopHoc }).populate('MonHoc PhongHoc GiangVien LopHoc').sort({ Thu: 1 }); // Thêm populate LopHoc
                dsLich = await formatLich(rawLich); // Đợi kết quả từ async map
            }
        }

        if (tuKhoaTraCuu) {
            const tuKhoaRegex = new RegExp(`^${tuKhoaTraCuu}$`, 'i');

            let sinhVien = await SinhVien.findOne({ MSSV: tuKhoaRegex })
                .populate('IDTaiKhoan', 'HoVaTen TenDangNhap')
                .populate('IDLop', 'MaLop TenLop');

            if (!sinhVien) {
                const taiKhoanSV = await TaiKhoan.findOne({ TenDangNhap: tuKhoaRegex, QuyenHan: 'sinhvien' });
                if (taiKhoanSV) {
                    sinhVien = await SinhVien.findOne({ IDTaiKhoan: taiKhoanSV._id })
                        .populate('IDTaiKhoan', 'HoVaTen TenDangNhap')
                        .populate('IDLop', 'MaLop TenLop');
                }
            }

            if (sinhVien && sinhVien.IDLop) {
                const dsLichTraCuu = await TKB.find({ LopHoc: sinhVien.IDLop._id, TrangThai: 'da-duyet' })
                    .populate('MonHoc PhongHoc GiangVien LopHoc')
                    .sort({ Thu: 1, TietBatDau: 1 });

                ketQuaTraCuu = {
                    loai: 'sinhvien',
                    tieuDe: `Kết quả tra cứu sinh viên`,
                    moTa: `${sinhVien.IDTaiKhoan?.HoVaTen || 'Sinh viên'} - ${sinhVien.MSSV} - ${sinhVien.IDLop.TenLop}`,
                    dsLich: await Promise.all(dsLichTraCuu.map(async item => { // Đợi kết quả từ async map
                        const ngayHocHienThi = await getFormattedNgayHoc(item);
                        return { ...item.toObject(), NgayHocHienThi: ngayHocHienThi };
                    }))
                };
            } else {
                let giangVien = await GiangVien.findOne({ MaGV: tuKhoaRegex })
                    .populate('IDTaiKhoan', 'HoVaTen TenDangNhap');

                if (!giangVien) {
                    const taiKhoanGV = await TaiKhoan.findOne({ TenDangNhap: tuKhoaRegex, QuyenHan: 'giangvien' });
                    if (taiKhoanGV) {
                        giangVien = await GiangVien.findOne({ IDTaiKhoan: taiKhoanGV._id })
                            .populate('IDTaiKhoan', 'HoVaTen TenDangNhap');
                    }
                }

                if (giangVien && giangVien.IDTaiKhoan) {
                    const dsLichTraCuu = await TKB.find({ GiangVien: giangVien.IDTaiKhoan._id, TrangThai: 'da-duyet' })
                        .populate('MonHoc PhongHoc GiangVien LopHoc')
                        .sort({ Thu: 1, TietBatDau: 1 });

                    ketQuaTraCuu = {
                        loai: 'giangvien',
                        tieuDe: `Kết quả tra cứu giảng viên`,
                        moTa: `${giangVien.IDTaiKhoan.HoVaTen} - ${giangVien.MaGV}`,
                        dsLich: await Promise.all(dsLichTraCuu.map(async item => { // Đợi kết quả từ async map
                            const ngayHocHienThi = await getFormattedNgayHoc(item);
                            return { ...item.toObject(), NgayHocHienThi: ngayHocHienThi };
                        }))
                    };
                } else {
                    ketQuaTraCuu = {
                        loai: 'khongtimthay',
                        tieuDe: 'Không tìm thấy kết quả phù hợp',
                        moTa: 'Vui lòng nhập MSSV, Mã GV hoặc tên đăng nhập hợp lệ.',
                        dsLich: []
                    };
                }
            }
        }

        // 5. RENDER DỮ LIỆU SANG EJS
        res.render('index', {
            title: 'Trang chủ Edu KT',
            path: '/',
            dsTaiKhoan: dsTaiKhoan,
            dsLich: dsLich,
            user: user,
            tuKhoaTraCuu: tuKhoaTraCuu,
            ketQuaTraCuu: ketQuaTraCuu,
            thongKeDashboard: [
                soLopDangHoc,
                tongPhong - soLopDangHoc,
                tongGV - soLopDangHoc
            ],
            isLoggedIn: !!user
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Lỗi phân luồng dữ liệu rồi! Kiểm tra Terminal nhé.");
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
        if (req.session.user) {
            req.session.error = 'Bạn đang ở trong hệ thống rồi mà!';
            return res.redirect('/');
        }

        const { TenDangNhap, MatKhau } = req.body;
        const taikhoan = await TaiKhoan.findOne({ TenDangNhap: TenDangNhap });

        if (taikhoan) {
            if (bcrypt.compareSync(MatKhau, taikhoan.MatKhau)) {
                if (taikhoan.TrangThai == 0) {
                    req.session.error = 'Tài khoản của bạn đang tạm khóa nhé.';
                    return res.redirect('/dangnhap');
                } else {

                    // --- ĐOẠN NÀY LÀ LINH HỒN CỦA "CÁ NHÂN HÓA" NÈ TÂM ---
                    let userSession = taikhoan.toObject(); // Biến tài khoản thành vật thể để thêm đồ vào

                    if (taikhoan.QuyenHan === 'sinhvien') {
                        // Tìm xem sinh viên này học lớp nào ở bảng SinhVien
                        const sv = await SinhVien.findOne({ IDTaiKhoan: taikhoan._id });
                        if (sv) {
                            userSession.LopHoc = sv.IDLop; // Gắn ID lớp vào để qua bên kia lọc TKB
                        }
                    } else if (taikhoan.QuyenHan === 'giangvien') {
                        // Giảng viên thì đã có _id sẵn rồi
                        userSession.GiangVien = taikhoan._id;
                    }

                    // LƯU SESSION ĐÃ CÓ ĐỦ ĐỒ CHƠI
                    req.session.user = userSession;
                    // ---------------------------------------------------

                    // PHÂN LUỒNG TÁC NHÂN (Giữ nguyên xi của Tâm nè)
                    if (taikhoan.QuyenHan === 'admin') {
                        req.session.success = 'Chào mừng Admin ! ';
                        return res.redirect('/taikhoan');
                    } else if (taikhoan.QuyenHan === 'giangvien') {
                        req.session.success = 'Chào Giảng viên! Chúc thầy/cô có buổi dạy tốt.';
                        return res.redirect('/');
                    } else {
                        req.session.success = 'Chào bạn sinh viên! Cố gắng học tập nhé.';
                        return res.redirect('/');
                    }
                }
            } else {
                req.session.error = 'Mật khẩu hổng đúng, kiểm tra lại nha.';
                return res.redirect('/dangnhap');
            }
        } else {
            req.session.error = 'Tên đăng nhập này chưa thấy trong máy.';
            return res.redirect('/dangnhap');
        }
    } catch (err) {
        console.error(err);
        req.session.error = 'Có chút lỗi kỹ thuật, thử lại nhé!';
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
