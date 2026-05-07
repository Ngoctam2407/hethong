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

// Sinh MSSV theo mã lớp, lấy số thứ tự tiếp theo trong lớp hiện tại.
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

// Xử lý upload file Excel vào bộ nhớ để import nhanh, không cần lưu file tạm.
function xuLyUploadExcel(req, res, next) {
    upload.single('excelFile')(req, res, function (err) {
        if (err) {
            req.session.error = err.message;
            return res.redirect('/taikhoan');
        }
        next();
    });
}

// Lấy giá trị từ một dòng Excel theo tên cột, hỗ trợ cả cột viết thường.
function layGiaTriDong(dong, truong) {
    return dong[truong] || dong[truong.toLowerCase()] || '';
}

// Khi import, tìm tài khoản cũ theo email hoặc tên đăng nhập để tránh tạo trùng.
async function timTaiKhoanImport(Email, TenDangNhap) {
    const tkTheoEmail = await TaiKhoan.findOne({ Email: Email });
    const tkTheoTenDangNhap = await TaiKhoan.findOne({ TenDangNhap: TenDangNhap });

    if (tkTheoEmail && tkTheoTenDangNhap && String(tkTheoEmail._id) !== String(tkTheoTenDangNhap._id)) {
        throw new Error('Email và TenDangNhap đang trùng với 2 tài khoản khác nhau.');
    }

    return tkTheoEmail || tkTheoTenDangNhap || null;
}

router.use(requireAdmin);
// GET: Danh sách tài khoản, kèm số lượng admin để bảo vệ admin cuối cùng.
router.get('/', async (req, res) => {
    var tk = await TaiKhoan.find();
    var soLuongAdmin = await TaiKhoan.countDocuments({ QuyenHan: 'admin' });
    res.render('taikhoan', { title: 'Danh sách tài khoản', taikhoan: tk, soLuongAdmin: soLuongAdmin });
});

// POST: Import tài khoản từ Excel, đồng thời tạo/cập nhật hồ sơ sinh viên hoặc giảng viên.
router.post('/import', xuLyUploadExcel, async (req, res) => {
    try {
        if (!req.file) {
            req.session.error = 'Bạn cần chọn file Excel trước khi import.';
            return res.redirect('/taikhoan');
        }

        const rows = readRowsFromExcel(req.file.buffer);
        if (!rows.length) {
            req.session.error = 'File Excel không có dòng dữ liệu nào.';
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
                    throw new Error('Thiếu HoVaTen, Email hoặc TenDangNhap.');
                }

                const QuyenHan = ['sinhvien', 'giangvien', 'admin'].includes(QuyenHanExcel) ? QuyenHanExcel : 'sinhvien';
                const taiKhoanCu = await timTaiKhoanImport(Email, TenDangNhap);

                let lopDuocGan = null;
                if (QuyenHan === 'sinhvien') {
                    if (!MaLop) {
                        throw new Error('Sinh viên bắt buộc phải có MaLop.');
                    }

                    lopDuocGan = mapMaLop.get(MaLop);
                    if (!lopDuocGan) {
                        throw new Error(`MaLop ${MaLop} không tồn tại trong hệ thống.`);
                    }
                }

                const thongTinGVCu = QuyenHan === 'giangvien'
                    ? await GiangVien.findOne({ IDTaiKhoan: taiKhoanCu ? taiKhoanCu._id : null })
                    : null;

                if (QuyenHan === 'giangvien' && !MaGV && !thongTinGVCu) {
                    throw new Error('Giảng viên mới bắt buộc phải có MaGV.');
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

        let thongBao = `Import tài khoản thành công: ${taoMoi} bản ghi mới, ${capNhat} bản ghi cập nhật.`;
        if (dongLoi.length > 0) {
            const tomTatLoi = dongLoi.slice(0, 5).join(' | ');
            thongBao += ` Có ${dongLoi.length} dòng bị bỏ qua. ${tomTatLoi}`;
        }

        req.session.success = thongBao;
        res.redirect('/taikhoan');
    } catch (err) {
        console.error(err);
        req.session.error = 'Lỗi import tài khoản: ' + err.message;
        res.redirect('/taikhoan');
    }
});

// GET: Xuất tài khoản ra Excel, ghép thêm dữ liệu sinh viên/giảng viên nếu có.
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
        req.session.error = 'Không thể export tài khoản: ' + err.message;
        res.redirect('/taikhoan');
    }
});

// GET: Form thêm tài khoản.
router.get('/them', async (req, res) => {
    var dsLop = await LopHoc.find();
    res.render('taikhoan_them', { title: 'Thêm tài khoản', dsLop: dsLop });
});

// POST: Tạo tài khoản mới và tạo hồ sơ phụ theo vai trò.
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

        // Bước 1: Tạo tài khoản chính trong bảng TaiKhoan.
        const tkMoi = await TaiKhoan.create(data);

        // Bước 2: Tạo bản ghi phụ để định danh sinh viên hoặc giảng viên.
        if (QuyenHan === 'sinhvien') {
            const MSSV = await taoMSSVTuDong(IDLop);
            await SinhVien.create({
                IDTaiKhoan: tkMoi._id,
                MSSV,
                IDLop: IDLop // Dùng ID lớp để lọc thời khóa biểu của sinh viên.
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

// GET: Form sửa tài khoản.
router.get('/sua/:id', async (req, res) => {
    var tk = await TaiKhoan.findById(req.params.id);
    if (!tk) {
        req.session.error = 'Không tìm thấy tài khoản.';
        return res.redirect('/taikhoan');
    }
    var dsLop = await LopHoc.find();
    let detail = null; // Dữ liệu phụ: sinh viên hoặc giảng viên.

    // Dựa vào quyền hạn để lấy đúng bảng phụ.
    if (tk.QuyenHan === 'sinhvien') {
        detail = await SinhVien.findOne({ IDTaiKhoan: tk._id });
    } else if (tk.QuyenHan === 'giangvien') {
        detail = await GiangVien.findOne({ IDTaiKhoan: tk._id });
    }
    res.render('taikhoan_sua', { title: 'Sửa tài khoản', tk: tk, dsLop: dsLop, detail: detail });

});

// POST: Cập nhật tài khoản và hồ sơ phụ, đồng thời bảo vệ admin cuối cùng.
router.post('/sua/:id', async (req, res) => {
    try {
        const { HoVaTen, Email, TenDangNhap, MatKhau, QuyenHan, IDLop, MaGV, LinhVuc, SoDienThoai } = req.body;
        const tkHienTai = await TaiKhoan.findById(req.params.id);

        if (!tkHienTai) {
            req.session.error = 'Không tìm thấy tài khoản cần cập nhật.';
            return res.redirect('/taikhoan');
        }

        if (QuyenHan === 'sinhvien') {
            if (!IDLop) {
                req.session.error = 'Sinh viên bắt buộc phải chọn lớp học.';
                return res.redirect('/taikhoan/sua/' + req.params.id);
            }
        }

        // Hệ thống phải luôn còn ít nhất 1 admin.
        if (tkHienTai.QuyenHan === 'admin' && QuyenHan !== 'admin') {
            const soLuongAdmin = await TaiKhoan.countDocuments({ QuyenHan: 'admin' });
            if (soLuongAdmin <= 1) {
                req.session.error = 'Không thể đổi quyền admin cuối cùng. Vui lòng tạo admin khác trước.';
                return res.redirect('/taikhoan/sua/' + req.params.id);
            }
        }

        // A. Cập nhật bảng TaiKhoan dùng chung cho mọi vai trò.
        let updateData = { HoVaTen, Email, TenDangNhap, QuyenHan };

        // Chỉ mã hóa và cập nhật mật khẩu khi người dùng nhập mật khẩu mới.
        if (MatKhau && MatKhau.trim() !== "" && MatKhau !== "********") {
            const salt = bcrypt.genSaltSync(10);
            updateData.MatKhau = bcrypt.hashSync(MatKhau, salt);
        }

        await TaiKhoan.findByIdAndUpdate(req.params.id, updateData);

        // B. Cập nhật bảng phụ theo vai trò.
        if (QuyenHan === 'sinhvien') {
            const thongTinSVCu = await SinhVien.findOne({ IDTaiKhoan: req.params.id });
            const doiLop = !thongTinSVCu || String(thongTinSVCu.IDLop) !== String(IDLop);
            const MSSV = doiLop
                ? await taoMSSVTuDong(IDLop, thongTinSVCu ? thongTinSVCu._id : null)
                : thongTinSVCu.MSSV;

            await SinhVien.findOneAndUpdate(
                { IDTaiKhoan: req.params.id },
                { MSSV, IDLop },
                { upsert: true } // Nếu chưa có hồ sơ phụ thì tạo mới.
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

// GET: Xóa tài khoản, không cho xóa admin cuối cùng.
router.get('/xoa/:id', async (req, res) => {
    try {
        const tkCanXoa = await TaiKhoan.findById(req.params.id);

        if (!tkCanXoa) {
            req.session.error = 'Không tìm thấy tài khoản cần xóa.';
            return res.redirect('/taikhoan');
        }

        if (tkCanXoa.QuyenHan === 'admin') {
            const soLuongAdmin = await TaiKhoan.countDocuments({ QuyenHan: 'admin' });
            if (soLuongAdmin <= 1) {
                req.session.error = 'Không thể xóa admin cuối cùng. Hệ thống phải có ít nhất 1 admin.';
                return res.redirect('/taikhoan');
            }
        }

        await TaiKhoan.findByIdAndDelete(req.params.id);
        req.session.success = 'Đã xóa tài khoản ' + tkCanXoa.HoVaTen + ' thành công.';
        res.redirect('/taikhoan');
    } catch (err) {
        req.session.error = 'Lỗi khi xóa tài khoản: ' + err.message;
        res.redirect('/taikhoan');
    }
});

// GET: Chuyển đổi trạng thái khóa/mở tài khoản.
router.get('/trangthai/:id', async (req, res) => {
    try {
        // 1. Tìm tài khoản hiện tại.
        var tk = await TaiKhoan.findById(req.params.id);
        if (!tk) {
            req.session.error = 'Không tìm thấy tài khoản.';
            return res.redirect('/taikhoan');
        }

        // Không cho khóa admin cuối cùng.
        if (tk.QuyenHan === 'admin' && tk.TrangThai == 1) {
            var soLuongAdmin = await TaiKhoan.countDocuments({ QuyenHan: 'admin' });
            if (soLuongAdmin <= 1) {
                req.session.error = 'Không thể khóa admin cuối cùng. Hệ thống phải có ít nhất 1 admin đang khả dụng.';
                return res.redirect('/taikhoan');
            }
        }

        // 2. Đảo ngược trạng thái: 1 là hoạt động, 0 là khóa.
        var trangThaiMoi = (tk.TrangThai == 1) ? 0 : 1;

        // 3. Cập nhật vào cơ sở dữ liệu.
        await TaiKhoan.findByIdAndUpdate(req.params.id, { TrangThai: trangThaiMoi });

        // 4. Gửi thông báo kết quả về giao diện.
        req.session.success = "Đã cập nhật trạng thái cho " + tk.HoVaTen + " thành công!";
        res.redirect('/taikhoan');
    } catch (err) {
        req.session.error = "Lỗi khi đổi trạng thái: " + err.message;
        res.redirect('/taikhoan');
    }
});


module.exports = router;
