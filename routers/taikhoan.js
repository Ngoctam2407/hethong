var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var TaiKhoan = require('../models/taikhoan');
var { requireAdmin } = require('./auth');
var LopHoc = require('../models/lophoc');
var SinhVien = require('../models/sinhvien');
var GiangVien = require('../models/giangvien');
var { upload, readRowsFromExcel, buildWorkbook, sendWorkbook, toNumber } = require('../utils/excel');

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

function xuLyUploadExcel(req, res, next) {
    upload.single('excelFile')(req, res, function (err) {
        if (err) {
            req.session.error = err.message;
            return res.redirect('/taikhoan');
        }
        next();
    });
}

function layGiaTriDong(dong, truong) {
    return dong[truong] || dong[truong.toLowerCase()] || '';
}

async function timTaiKhoanImport(Email, TenDangNhap) {
    const tkTheoEmail = await TaiKhoan.findOne({ Email: Email });
    const tkTheoTenDangNhap = await TaiKhoan.findOne({ TenDangNhap: TenDangNhap });

    if (tkTheoEmail && tkTheoTenDangNhap && String(tkTheoEmail._id) !== String(tkTheoTenDangNhap._id)) {
        throw new Error('Email va TenDangNhap dang trung voi 2 tai khoan khac nhau.');
    }

    return tkTheoEmail || tkTheoTenDangNhap || null;
}

router.use(requireAdmin);
// 1. GET: Danh sách (Địa chỉ: /taikhoan)
router.get('/', async (req, res) => {
    var tk = await TaiKhoan.find();
    var soLuongAdmin = await TaiKhoan.countDocuments({ QuyenHan: 'admin' });
    res.render('taikhoan', { title: 'Danh sách tài khoản', taikhoan: tk, soLuongAdmin: soLuongAdmin });
});

router.post('/import', xuLyUploadExcel, async (req, res) => {
    try {
        if (!req.file) {
            req.session.error = 'Ban can chon file Excel truoc khi import.';
            return res.redirect('/taikhoan');
        }

        const rows = readRowsFromExcel(req.file.buffer);
        if (!rows.length) {
            req.session.error = 'File Excel khong co dong du lieu nao.';
            return res.redirect('/taikhoan');
        }

        let taoMoi = 0;
        let capNhat = 0;
        const dongLoi = [];
        const dsLop = await LopHoc.find().select('_id MaLop').lean();
        const mapMaLop = new Map(
            dsLop.map(function (lop) {
                return [String(lop.MaLop).trim().toUpperCase(), lop];
            })
        );

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];

            try {
                const HoVaTen = String(layGiaTriDong(row, 'HoVaTen')).trim();
                const Email = String(layGiaTriDong(row, 'Email')).trim().toLowerCase();
                const TenDangNhap = String(layGiaTriDong(row, 'TenDangNhap')).trim();
                const MatKhauExcel = String(layGiaTriDong(row, 'MatKhau')).trim();
                const QuyenHanExcel = String(layGiaTriDong(row, 'QuyenHan') || 'sinhvien').trim().toLowerCase();
                const TrangThai = toNumber(layGiaTriDong(row, 'TrangThai'), 1);
                const MaLop = String(layGiaTriDong(row, 'MaLop')).trim().toUpperCase();
                const MaGV = String(layGiaTriDong(row, 'MaGV')).trim();
                const LinhVuc = String(layGiaTriDong(row, 'LinhVuc')).trim();
                const SoDienThoai = String(layGiaTriDong(row, 'SoDienThoai')).trim();

                if (!HoVaTen || !Email || !TenDangNhap) {
                    throw new Error('Thieu HoVaTen, Email hoac TenDangNhap.');
                }

                const QuyenHan = ['sinhvien', 'giangvien', 'admin'].includes(QuyenHanExcel) ? QuyenHanExcel : 'sinhvien';
                const taiKhoanCu = await timTaiKhoanImport(Email, TenDangNhap);

                let lopDuocGan = null;
                if (QuyenHan === 'sinhvien') {
                    if (!MaLop) {
                        throw new Error('Sinh vien bat buoc phai co MaLop.');
                    }

                    lopDuocGan = mapMaLop.get(MaLop);
                    if (!lopDuocGan) {
                        throw new Error(`MaLop ${MaLop} khong ton tai trong he thong.`);
                    }
                }

                const thongTinGVCu = QuyenHan === 'giangvien'
                    ? await GiangVien.findOne({ IDTaiKhoan: taiKhoanCu ? taiKhoanCu._id : null })
                    : null;

                if (QuyenHan === 'giangvien' && !MaGV && !thongTinGVCu) {
                    throw new Error('Giang vien moi bat buoc phai co MaGV.');
                }

                let MatKhau = taiKhoanCu ? taiKhoanCu.MatKhau : '';
                if (MatKhauExcel) {
                    if (MatKhauExcel.startsWith('$2')) {
                        MatKhau = MatKhauExcel;
                    } else {
                        const salt = bcrypt.genSaltSync(10);
                        MatKhau = bcrypt.hashSync(MatKhauExcel, salt);
                    }
                } else if (!MatKhau) {
                    const salt = bcrypt.genSaltSync(10);
                    MatKhau = bcrypt.hashSync('123456', salt);
                }

                const duLieu = {
                    HoVaTen,
                    Email,
                    TenDangNhap,
                    MatKhau,
                    QuyenHan,
                    TrangThai
                };

                let taiKhoanSauKhiLuu = taiKhoanCu;
                if (taiKhoanCu) {
                    await TaiKhoan.findByIdAndUpdate(taiKhoanCu._id, duLieu);
                    taiKhoanSauKhiLuu = await TaiKhoan.findById(taiKhoanCu._id);
                    capNhat++;
                } else {
                    taiKhoanSauKhiLuu = await TaiKhoan.create(duLieu);
                    taoMoi++;
                }

                if (QuyenHan === 'sinhvien') {
                    const thongTinSVCu = await SinhVien.findOne({ IDTaiKhoan: taiKhoanSauKhiLuu._id });
                    const doiLop = !thongTinSVCu || String(thongTinSVCu.IDLop) !== String(lopDuocGan._id);
                    const MSSV = doiLop
                        ? await taoMSSVTuDong(lopDuocGan._id, thongTinSVCu ? thongTinSVCu._id : null)
                        : thongTinSVCu.MSSV;

                    await SinhVien.findOneAndUpdate(
                        { IDTaiKhoan: taiKhoanSauKhiLuu._id },
                        {
                            MSSV,
                            IDLop: lopDuocGan._id,
                            SoDienThoai: SoDienThoai || (thongTinSVCu ? thongTinSVCu.SoDienThoai : '')
                        },
                        { upsert: true }
                    );
                } else if (QuyenHan === 'giangvien') {
                    await GiangVien.findOneAndUpdate(
                        { IDTaiKhoan: taiKhoanSauKhiLuu._id },
                        {
                            MaGV: MaGV || thongTinGVCu.MaGV,
                            LinhVuc: LinhVuc || (thongTinGVCu ? thongTinGVCu.LinhVuc : ''),
                            SoDienThoai: SoDienThoai || (thongTinGVCu ? thongTinGVCu.SoDienThoai : '')
                        },
                        { upsert: true }
                    );
                }
            } catch (rowError) {
                dongLoi.push(`Dong ${i + 2}: ${rowError.message}`);
            }
        }

        let thongBao = `Import tai khoan thanh cong: ${taoMoi} ban ghi moi, ${capNhat} ban ghi cap nhat.`;
        if (dongLoi.length > 0) {
            const tomTatLoi = dongLoi.slice(0, 5).join(' | ');
            thongBao += ` Co ${dongLoi.length} dong bi bo qua. ${tomTatLoi}`;
        }

        req.session.success = thongBao;
        res.redirect('/taikhoan');
    } catch (err) {
        console.error(err);
        req.session.error = 'Loi import tai khoan: ' + err.message;
        res.redirect('/taikhoan');
    }
});

router.get('/export', async (req, res) => {
    try {
        const dsTaiKhoan = await TaiKhoan.find().sort({ HoVaTen: 1 }).lean();
        const dsSinhVien = await SinhVien.find().populate('IDLop', 'MaLop').lean();
        const dsGiangVien = await GiangVien.find().lean();
        const mapSinhVien = new Map(dsSinhVien.map(function (sv) {
            return [String(sv.IDTaiKhoan), sv];
        }));
        const mapGiangVien = new Map(dsGiangVien.map(function (gv) {
            return [String(gv.IDTaiKhoan), gv];
        }));

        const rows = dsTaiKhoan.map(function (tk) {
            const sv = mapSinhVien.get(String(tk._id));
            const gv = mapGiangVien.get(String(tk._id));
            return {
                HoVaTen: tk.HoVaTen,
                Email: tk.Email,
                TenDangNhap: tk.TenDangNhap,
                MatKhau: tk.MatKhau,
                QuyenHan: tk.QuyenHan,
                TrangThai: tk.TrangThai,
                MaLop: sv && sv.IDLop ? sv.IDLop.MaLop : '',
                MSSV: sv ? sv.MSSV : '',
                MaGV: gv ? gv.MaGV : '',
                LinhVuc: gv ? gv.LinhVuc || '' : '',
                SoDienThoai: gv ? gv.SoDienThoai || '' : (sv ? sv.SoDienThoai || '' : '')
            };
        });

        const workbook = buildWorkbook('TaiKhoan', rows);
        sendWorkbook(res, workbook, 'taikhoan.xlsx');
    } catch (err) {
        console.error(err);
        req.session.error = 'Khong the export tai khoan: ' + err.message;
        res.redirect('/taikhoan');
    }
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
    if (!tk) {
        req.session.error = 'Khong tim thay tai khoan.';
        return res.redirect('/taikhoan');
    }
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
        const tkHienTai = await TaiKhoan.findById(req.params.id);

        if (!tkHienTai) {
            req.session.error = 'Khong tim thay tai khoan can cap nhat.';
            return res.redirect('/taikhoan');
        }

        if (QuyenHan === 'sinhvien') {
            if (!IDLop) {
                req.session.error = 'Sinh viên bắt buộc phải chọn lớp học.';
                return res.redirect('/taikhoan/sua/' + req.params.id);
            }
        }

        // He thong phai luon con it nhat 1 admin.
        if (tkHienTai.QuyenHan === 'admin' && QuyenHan !== 'admin') {
            const soLuongAdmin = await TaiKhoan.countDocuments({ QuyenHan: 'admin' });
            if (soLuongAdmin <= 1) {
                req.session.error = 'Khong the doi quyen admin cuoi cung. Vui long tao admin khac truoc.';
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
    try {
        const tkCanXoa = await TaiKhoan.findById(req.params.id);

        if (!tkCanXoa) {
            req.session.error = 'Khong tim thay tai khoan can xoa.';
            return res.redirect('/taikhoan');
        }

        if (tkCanXoa.QuyenHan === 'admin') {
            const soLuongAdmin = await TaiKhoan.countDocuments({ QuyenHan: 'admin' });
            if (soLuongAdmin <= 1) {
                req.session.error = 'Khong the xoa admin cuoi cung. He thong phai co it nhat 1 admin.';
                return res.redirect('/taikhoan');
            }
        }

        await TaiKhoan.findByIdAndDelete(req.params.id);
        req.session.success = 'Da xoa tai khoan ' + tkCanXoa.HoVaTen + ' thanh cong.';
        res.redirect('/taikhoan');
    } catch (err) {
        req.session.error = 'Loi khi xoa tai khoan: ' + err.message;
        res.redirect('/taikhoan');
    }
});

// 7. GET: Chuyển đổi trạng thái khóa/mở (Địa chỉ: /taikhoan/trangthai/:id)
router.get('/trangthai/:id', async (req, res) => {
    try {
        // 1. Tìm tài khoản hiện tại
        var tk = await TaiKhoan.findById(req.params.id);
        if (!tk) {
            req.session.error = 'Khong tim thay tai khoan.';
            return res.redirect('/taikhoan');
        }

        // Khong cho khoa admin cuoi cung (trang thai 1 -> 0)
        if (tk.QuyenHan === 'admin' && tk.TrangThai == 1) {
            var soLuongAdmin = await TaiKhoan.countDocuments({ QuyenHan: 'admin' });
            if (soLuongAdmin <= 1) {
                req.session.error = 'Khong the khoa admin cuoi cung. He thong phai co it nhat 1 admin dang kha dung.';
                return res.redirect('/taikhoan');
            }
        }

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
