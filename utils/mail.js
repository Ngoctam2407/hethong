const nodemailer = require('nodemailer');

function taoMailTransporter() {
    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_APP_PASSWORD;

    if (!user || !pass) {
        return null;
    }

    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: user,
            pass: pass
        }
    });
}

async function guiEmailQuenMatKhau(emailNhan, tenNguoiDung, duongDanDatLai) {
    const transporter = taoMailTransporter();
    if (!transporter) {
        throw new Error('Chưa cấu hình MAIL_USER hoặc MAIL_APP_PASSWORD.');
    }

    await transporter.sendMail({
        from: process.env.MAIL_USER,
        to: emailNhan,
        subject: 'Dat lai mat khau he thong KT',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
                <h2>Yeu cau dat lai mat khau</h2>
                <p>Xin chao ${tenNguoiDung || 'ban'},</p>
                <p>He thong da nhan duoc yeu cau dat lai mat khau cho tai khoan cua ban.</p>
                <p>
                    <a href="${duongDanDatLai}" style="display: inline-block; padding: 12px 18px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px;">
                        Dat lai mat khau
                    </a>
                </p>
                <p>Neu ban khong thuc hien yeu cau nay, hay bo qua email.</p>
                <p>Link nay se het han sau 15 phut.</p>
            </div>
        `
    });
}

module.exports = {
    guiEmailQuenMatKhau
};
