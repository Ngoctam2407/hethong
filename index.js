// Khởi tạo thư viện, router và tiện ích dùng chung cho toàn bộ hệ thống.
var express = require('express');
var app = express();
var mongoose = require('mongoose');
var session = require('express-session');
var indexRouter = require('./routers/index');
var taikhoanRouter = require('./routers/taikhoan');
var authRouter = require('./routers/auth');
var phonghocRouter = require('./routers/phonghoc');
var tkbRouter = require('./routers/tkb');
var lophocRouter = require('./routers/lophoc');
var monhocRouter = require('./routers/monhoc');
var thongbaoRouter = require('./routers/thongbao');
var { getPublicKey } = require('./utils/push');



// Cấu hình kết nối MongoDB: mọi model trong thư mục models sẽ dùng chung kết nối này.
var uri = 'mongodb://user:user2407@ac-r9v15gv-shard-00-01.b99rhcp.mongodb.net:27017/hethong?ssl=true&authSource=admin';
mongoose.connect(uri).then(() => console.log('Đã kết nối thành công MongoDB rồi nha'))
    .catch(err => console.log('Hệ thống lỗi kết nối, không kết nối được', err));

const TaiKhoan = require('./models/taikhoan');
const bcryptjs = require('bcryptjs');

async function taoAdminDauTien() {
    try {
        const check = await TaiKhoan.findOne({ TenDangNhap: 'admin' });
        if (!check) {
            const salt = await bcryptjs.genSalt(10);
            const hashedPass = await bcryptjs.hash('123456', salt);

            await TaiKhoan.create({
                HoVaTen: 'Quản Trị Viên Tâm',
                Email: 'admin@khaitri.edu.vn',
                TenDangNhap: 'admin',
                MatKhau: hashedPass,
                QuyenHan: 'admin',
                TrangThai: 1
            });
            console.log('Đã tạo tài khoản Admin mặc định thành công!');
        }
    } catch (err) {
        console.log('Lỗi tạo Admin rồi Tâm ơi: ', err);
    }
}
taoAdminDauTien(); // Tạo tài khoản admin mặc định nếu hệ thống chưa có admin.

// Cấu hình giao diện, public asset và middleware đọc dữ liệu gửi từ form/API.
app.set('views', './views');
app.set('view engine', 'ejs');
app.locals.webPushPublicKey = getPublicKey();
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    name: 'Mysunny', // Tên session (tự chọn)
    secret: 'he hé he hè he', // Khóa bảo vệ (tự chọn)
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000 // Hết hạn sau 30 ngày
    }
}));
app.use((req, res, next) => {
    // Đưa thông tin đăng nhập và thông báo nhanh vào res.locals để mọi view EJS đều dùng được.
    res.locals.session = req.session;
    res.locals.isLoggedIn = (req.session && req.session.user) ? true : false;
    res.locals.user = req.session.user || null;
    res.locals.webPushPublicKey = getPublicKey();

    // Lấy thông báo (lỗi, thành công) của trang trước đó nếu có.
    var err = req.session.error;
    var msg = req.session.success;

    // Xóa thông báo tạm để tránh hiển thị lặp lại khi người dùng tải lại trang.
    delete req.session.error;
    delete req.session.success;

    // Gán HTML thông báo vào biến cục bộ cho layout/header hiển thị.
    res.locals.message = '';
    if (err) res.locals.message = '<span class="text-danger">' + err + '</span>';
    if (msg) res.locals.message = '<span class="text-success">' + msg + '</span>';

    next();
});


// Gắn tiền tố URL cho từng nhóm chức năng chính của hệ thống.
app.use('/', indexRouter);
app.use('/taikhoan', taikhoanRouter);
app.use('/auth', authRouter);
app.use('/phonghoc', phonghocRouter);
app.use('/tkb', tkbRouter);
app.use('/lophoc', lophocRouter);
app.use('/monhoc', monhocRouter);
app.use('/thongbao', thongbaoRouter);



app.get('/', (req, res) => {
    res.render('index', {
        title: 'Trang chủ ',

    });
});

app.listen(2407, () => {
    console.log('Hệ thống của Tâm đang chạy tại cổng http://127.0.0.1:2407');
});
