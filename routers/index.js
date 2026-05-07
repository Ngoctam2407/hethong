var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var TaiKhoan = require('../models/taikhoan');
var PhongHoc = require('../models/phonghoc');
var LopHoc = require('../models/lophoc');
var SinhVien = require('../models/sinhvien');
var GiangVien = require('../models/giangvien');
var TKB = require('../models/tkb');
var { requireAdmin } = require('./auth');
var { getFormattedNgayHoc } = require('../utils/date_helpers');
var { buildWorkbook, sendWorkbook } = require('../utils/excel');

const KHUNG_GIO_HOC = [
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

function dauNgay(date) {
    const moc = new Date(date);
    moc.setHours(0, 0, 0, 0);
    return moc;
}

function congNgay(date, soNgay) {
    const moc = new Date(date);
    moc.setDate(moc.getDate() + soNgay);
    return moc;
}

function layTietHienTai() {
    const gioHienTai = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    return KHUNG_GIO_HOC.find(function (khung) {
        return gioHienTai >= khung.batDau && gioHienTai < khung.ketThuc;
    }) || null;
}

function formatNgay(date) {
    if (!date) return '';
    return new Date(date).toLocaleDateString('vi-VN');
}

function formatNgayGio(date) {
    if (!date) return '';
    return new Date(date).toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function trangThaiTheoNgay(ngayHoc, homNay, ngayMai) {
    if (!ngayHoc) return 'Chưa xác định';
    const ngay = new Date(ngayHoc);
    if (ngay < homNay) return 'Đã qua';
    if (ngay >= homNay && ngay < ngayMai) return 'Hôm nay';
    return 'Sắp tới';
}

async function taoDuLieuBaoCaoHeThong() {
    const bayGio = new Date();
    const homNay = dauNgay(bayGio);
    const ngayMai = congNgay(homNay, 1);
    const bayNgayTruoc = congNgay(homNay, -6);
    const tietHienTai = layTietHienTai();

    const [
        tongLop,
        tongLopHoatDong,
        tongPhong,
        dsPhong,
        tongSinhVien,
        tongGiangVien,
        tongLichChoDuyet,
        lichHomNay,
        lichBayNgay,
        lichGanDay,
        dsLop,
        dsSinhVien
    ] = await Promise.all([
        LopHoc.countDocuments(),
        LopHoc.countDocuments({ TrangThai: 1 }),
        PhongHoc.countDocuments(),
        PhongHoc.find().sort({ TenPhong: 1 }).lean(),
        SinhVien.countDocuments(),
        TaiKhoan.countDocuments({ QuyenHan: 'giangvien' }),
        TKB.countDocuments({ TrangThai: 'cho-duyet' }),
        TKB.find({ TrangThai: 'da-duyet', NgayHoc: { $gte: homNay, $lt: ngayMai } })
            .populate('MonHoc GiangVien LopHoc PhongHoc')
            .sort({ TietBatDau: 1 })
            .lean(),
        TKB.find({ TrangThai: 'da-duyet', NgayHoc: { $gte: bayNgayTruoc, $lt: ngayMai } })
            .select('NgayHoc PhongHoc TietBatDau TietKetThuc')
            .lean(),
        TKB.find({ TrangThai: 'da-duyet', NgayHoc: { $ne: null } })
            .populate('MonHoc GiangVien LopHoc PhongHoc')
            .sort({ NgayHoc: -1, TietBatDau: -1 })
            .limit(80)
            .lean(),
        LopHoc.find().sort({ MaLop: 1 }).lean(),
        SinhVien.find()
            .populate('IDTaiKhoan', 'HoVaTen Email TrangThai')
            .populate('IDLop', 'MaLop TenLop SiSo TrangThai')
            .sort({ createdAt: -1 })
            .limit(500)
            .lean()
    ]);

    const phongHoatDong = dsPhong.filter(function (phong) {
        return phong.TrangThai !== 0 && !phong.KhoaThuCong;
    });
    const phongBaoTri = dsPhong.filter(function (phong) {
        return phong.TrangThai === 0 || phong.KhoaThuCong;
    });
    const phongDangDungSet = new Set();

    if (tietHienTai) {
        lichHomNay.forEach(function (lich) {
            if (lich.TietBatDau <= tietHienTai.tiet && lich.TietKetThuc >= tietHienTai.tiet && lich.PhongHoc) {
                phongDangDungSet.add(String(lich.PhongHoc._id || lich.PhongHoc));
            }
        });
    }

    const tiLeSuDungPhong = phongHoatDong.length
        ? Math.round((phongDangDungSet.size / phongHoatDong.length) * 100)
        : 0;

    const lopCountMap = new Map();
    dsSinhVien.forEach(function (sv) {
        const lopId = sv.IDLop ? String(sv.IDLop._id || sv.IDLop) : '';
        if (!lopId) return;
        lopCountMap.set(lopId, (lopCountMap.get(lopId) || 0) + 1);
    });

    const thongKeLop = dsLop.map(function (lop) {
        const soHocVien = lopCountMap.get(String(lop._id)) || 0;
        return {
            maLop: lop.MaLop || '',
            tenLop: lop.TenLop || '',
            siSo: lop.SiSo || 0,
            soHocVien: soHocVien,
            trangThai: lop.TrangThai === 1 ? 'Đang hoạt động' : 'Tạm ngưng'
        };
    });

    const bieuDoCot = [];
    for (let i = 0; i < 7; i++) {
        const ngay = congNgay(bayNgayTruoc, i);
        const ngayKey = ngay.toISOString().slice(0, 10);
        const soLich = lichBayNgay.filter(function (lich) {
            return lich.NgayHoc && new Date(lich.NgayHoc).toISOString().slice(0, 10) === ngayKey;
        }).length;
        bieuDoCot.push({
            label: ngay.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
            soLich: soLich
        });
    }

    const lichSuSuDungPhong = lichGanDay.map(function (lich) {
        const soTiet = (lich.TietKetThuc || 0) - (lich.TietBatDau || 0) + 1;
        return {
            ngayHoc: formatNgay(lich.NgayHoc),
            thu: lich.Thu || '',
            phong: lich.PhongHoc ? lich.PhongHoc.TenPhong : 'Chưa có phòng',
            lop: lich.LopHoc ? lich.LopHoc.TenLop : 'Chưa có lớp',
            monHoc: lich.MonHoc ? lich.MonHoc.TenMonHoc : 'Chưa có môn',
            giangVien: lich.GiangVien ? lich.GiangVien.HoVaTen : 'Chưa có giảng viên',
            tiet: `${lich.TietBatDau || ''}-${lich.TietKetThuc || ''}`,
            soTiet: soTiet > 0 ? soTiet : 0,
            trangThai: trangThaiTheoNgay(lich.NgayHoc, homNay, ngayMai)
        };
    });

    const hocVienTheoLop = dsSinhVien.map(function (sv) {
        return {
            mssv: sv.MSSV || '',
            hoVaTen: sv.IDTaiKhoan ? sv.IDTaiKhoan.HoVaTen : 'Chưa có tài khoản',
            email: sv.IDTaiKhoan ? sv.IDTaiKhoan.Email : '',
            maLop: sv.IDLop ? sv.IDLop.MaLop : '',
            tenLop: sv.IDLop ? sv.IDLop.TenLop : 'Chưa có lớp',
            trangThai: sv.IDTaiKhoan && sv.IDTaiKhoan.TrangThai === 0 ? 'Tạm khóa' : 'Đang học',
            ngaySinh: formatNgay(sv.NgaySinh),
            soDienThoai: sv.SoDienThoai || ''
        };
    });

    const danhSachLop = Array.from(new Set(hocVienTheoLop.map(function (sv) {
        return sv.tenLop;
    }).filter(Boolean))).sort();

    return {
        capNhatLuc: formatNgayGio(bayGio),
        tietHienTai: tietHienTai ? `Tiết ${tietHienTai.tiet} (${tietHienTai.batDau} - ${tietHienTai.ketThuc})` : 'Ngoài khung giờ học',
        thongKe: {
            tongLop: tongLop,
            lopHoatDong: tongLopHoatDong,
            tongPhong: tongPhong,
            phongHoatDong: phongHoatDong.length,
            phongDangDung: phongDangDungSet.size,
            phongBaoTri: phongBaoTri.length,
            tiLeSuDungPhong: tiLeSuDungPhong,
            tongSinhVien: tongSinhVien,
            tongGiangVien: tongGiangVien,
            lichHomNay: lichHomNay.length,
            lichChoDuyet: tongLichChoDuyet
        },
        bieuDo: {
            lichTheoNgay: bieuDoCot,
            phong: [
                { label: 'Đang sử dụng', value: phongDangDungSet.size },
                { label: 'Sẵn sàng', value: Math.max(phongHoatDong.length - phongDangDungSet.size, 0) },
                { label: 'Bảo trì/tạm khóa', value: phongBaoTri.length }
            ]
        },
        thongKeLop: thongKeLop,
        lichSuSuDungPhong: lichSuSuDungPhong,
        hocVienTheoLop: hocVienTheoLop,
        danhSachLop: danhSachLop
    };
}

router.get('/admin', requireAdmin, async (req, res) => {
    try {
        const baoCao = await taoDuLieuBaoCaoHeThong();
        res.render('admin_baocao', {
            title: 'Báo cáo hệ thống',
            path: '/admin',
            baoCao: baoCao
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Không tải được báo cáo hệ thống: ' + err.message);
    }
});

router.get('/admin/bao-cao-he-thong', requireAdmin, async (req, res) => {
    res.redirect('/admin');
});

router.get('/admin/bao-cao-he-thong/data', requireAdmin, async (req, res) => {
    try {
        const baoCao = await taoDuLieuBaoCaoHeThong();
        res.json({ ok: true, baoCao: baoCao });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Không tải được dữ liệu báo cáo.' });
    }
});

router.get('/admin/bao-cao-he-thong/export', requireAdmin, async (req, res) => {
    try {
        const baoCao = await taoDuLieuBaoCaoHeThong();
        const rows = [
            { Nhom: 'Tổng quan', ChiTiet: 'Lớp đang hoạt động', GiaTri: baoCao.thongKe.lopHoatDong },
            { Nhom: 'Tổng quan', ChiTiet: 'Tỷ lệ sử dụng phòng hiện tại', GiaTri: baoCao.thongKe.tiLeSuDungPhong + '%' },
            { Nhom: 'Tổng quan', ChiTiet: 'Phòng đang sử dụng', GiaTri: baoCao.thongKe.phongDangDung },
            { Nhom: 'Tổng quan', ChiTiet: 'Lịch học hôm nay', GiaTri: baoCao.thongKe.lichHomNay },
            { Nhom: 'Tổng quan', ChiTiet: 'Học viên', GiaTri: baoCao.thongKe.tongSinhVien },
            ...baoCao.lichSuSuDungPhong.map(function (item) {
                return {
                    Nhom: 'Lịch sử sử dụng phòng',
                    ChiTiet: item.phong,
                    GiaTri: `${item.ngayHoc} - ${item.lop} - ${item.monHoc} - tiết ${item.tiet}`
                };
            }),
            ...baoCao.hocVienTheoLop.map(function (item) {
                return {
                    Nhom: 'Học viên theo lớp',
                    ChiTiet: item.tenLop,
                    GiaTri: `${item.mssv} - ${item.hoVaTen} - ${item.trangThai}`
                };
            })
        ];
        const workbook = buildWorkbook('BaoCaoHeThong', rows);
        const fileName = 'bao-cao-he-thong-' + new Date().toLocaleDateString('vi-VN').replace(/\//g, '-') + '.xlsx';
        sendWorkbook(res, workbook, fileName);
    } catch (err) {
        console.error(err);
        res.status(500).send('Không xuất được báo cáo: ' + err.message);
    }
});

// GET: Trang chủ
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;
        const tuKhoaTraCuu = String(req.query.q || '').trim();
        const homNay = new Date();
        homNay.setHours(0, 0, 0, 0);
        const ngayMai = new Date(homNay);
        ngayMai.setDate(ngayMai.getDate() + 1);

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

        const gioHienTai = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        const tietHienTai = khungGioHoc.find(g => gioHienTai >= g.batDau && gioHienTai < g.ketThuc)?.tiet;
        const tietMocSapToi = (khungGioHoc.find(g => gioHienTai < g.ketThuc)?.tiet) || 13;
        const dieuKienLichSapToi = {
            TrangThai: 'da-duyet',
            $or: [
                { NgayHoc: { $gte: ngayMai } },
                { NgayHoc: { $gte: homNay, $lt: ngayMai }, TietKetThuc: { $gte: tietMocSapToi } }
            ]
        };
        const dsThu = ["Chủ Nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
        const thuHomNay = dsThu[new Date().getDay()];

        // 3. TRUY VẤN DỮ LIỆU THƯỜNG KÊ (DÙNG await ĐỂ ĐỢI LẤY XONG SỐ LIỆU)
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

        // 4. Phân quyền hiển thị dữ liệu theo vai trò người dùng
        let dsLich = [];
        let dsTaiKhoan = [];
        let ketQuaTraCuu = null;
        if (user) {
            const formatLich = async (list) => {
                return await Promise.all(list.map(async item => {
                    const ngayHocHienThi = await getFormattedNgayHoc(item);
                    return { ...item.toObject(), NgayHocHienThi: ngayHocHienThi };
                }));
            };

            if (user.QuyenHan === 'admin') {
                const rawLich = await TKB.find(dieuKienLichSapToi).populate('MonHoc PhongHoc GiangVien LopHoc').sort({ NgayHoc: 1, TietBatDau: 1 }).limit(5); // Thêm populate LopHoc
                dsLich = await formatLich(rawLich);
                dsTaiKhoan = await TaiKhoan.find();
            } else if (user.QuyenHan === 'giangvien') {
                const rawLich = await TKB.find({ GiangVien: user._id, ...dieuKienLichSapToi }).populate('MonHoc PhongHoc GiangVien LopHoc').sort({ NgayHoc: 1, TietBatDau: 1 }).limit(5); // Thêm populate LopHoc
                dsLich = await formatLich(rawLich);
            } else if (user.QuyenHan === 'sinhvien') {
                const rawLich = await TKB.find({ LopHoc: user.LopHoc, ...dieuKienLichSapToi }).populate('MonHoc PhongHoc GiangVien LopHoc').sort({ NgayHoc: 1, TietBatDau: 1 }).limit(5); // Thêm populate LopHoc
                dsLich = await formatLich(rawLich);
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
                const dsLichTraCuu = await TKB.find({ LopHoc: sinhVien.IDLop._id, ...dieuKienLichSapToi })
                    .populate('MonHoc PhongHoc GiangVien LopHoc')
                    .sort({ NgayHoc: 1, TietBatDau: 1 })
                    .limit(10);

                ketQuaTraCuu = {
                    loai: 'sinhvien',
                    tieuDe: `Kết quả tra cứu sinh viên`,
                    moTa: `${sinhVien.IDTaiKhoan?.HoVaTen || 'Sinh viên'} - ${sinhVien.MSSV} - ${sinhVien.IDLop.TenLop}`,
                    dsLich: await Promise.all(dsLichTraCuu.map(async item => { // Đổi kết quả từ async map
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
                    const dsLichTraCuu = await TKB.find({ GiangVien: giangVien.IDTaiKhoan._id, ...dieuKienLichSapToi })
                        .populate('MonHoc PhongHoc GiangVien LopHoc')
                        .sort({ NgayHoc: 1, TietBatDau: 1 })
                        .limit(10);

                    ketQuaTraCuu = {
                        loai: 'giangvien',
                        tieuDe: `Kết quả tra cứu giảng viên`,
                        moTa: `${giangVien.IDTaiKhoan.HoVaTen} - ${giangVien.MaGV}`,
                        dsLich: await Promise.all(dsLichTraCuu.map(async item => { // Đổi kết quả từ async map
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
        res.status(500).send("Lỗi rồi kiểm tra terminal.");
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
            req.session.error = 'Bạn đang ở trong hệ thống rồi!';
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

                    let userSession = taikhoan.toObject(); // Biến tài khoản thành vật thể để thêm đồ vào

                    if (taikhoan.QuyenHan === 'sinhvien') {
                        // Tìm xem sinh viên này học lớp nào ở bảng SinhVien
                        const sv = await SinhVien.findOne({ IDTaiKhoan: taikhoan._id });
                        if (sv) {
                            userSession.LopHoc = sv.IDLop;
                        }
                    } else if (taikhoan.QuyenHan === 'giangvien') {
                        userSession.GiangVien = taikhoan._id;
                    }

                    req.session.user = userSession;
                    // ---------------------------------------------------

                    if (taikhoan.QuyenHan === 'admin') {
                        req.session.success = 'Chào mừng Admin ! ';
                        return res.redirect('/admin');
                    } else if (taikhoan.QuyenHan === 'giangvien') {
                        req.session.success = 'Chào giảng viên! Chúc thầy/cô có buổi dạy tốt.';
                        return res.redirect('/');
                    } else {
                        req.session.success = 'Chào bạn sinh viên! Cố gắng học tập nhé.';
                        return res.redirect('/');
                    }
                }
            } else {
                req.session.error = 'Mật khẩu không đúng, kiểm tra lại.';
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
