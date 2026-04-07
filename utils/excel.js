const multer = require('multer');
const path = require('path');
const XLSX = require('xlsx');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: function (req, file, cb) {
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (ext !== '.xlsx' && ext !== '.xls') {
            return cb(new Error('Chi chap nhan file Excel .xlsx hoac .xls.'));
        }
        cb(null, true);
    }
});

function readRowsFromExcel(fileBuffer) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];

    if (!firstSheetName) {
        throw new Error('File Excel khong co sheet du lieu.');
    }

    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(sheet, {
        defval: '',
        raw: false
    });
}

function buildWorkbook(sheetName, rows) {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    return workbook;
}

function sendWorkbook(res, workbook, fileName) {
    const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx'
    });

    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileName}"`
    );
    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buffer);
}

function toNumber(value, defaultValue) {
    if (value === '' || value === null || typeof value === 'undefined') {
        return defaultValue;
    }

    const parsed = Number(value);
    return Number.isNaN(parsed) ? defaultValue : parsed;
}

module.exports = {
    upload,
    readRowsFromExcel,
    buildWorkbook,
    sendWorkbook,
    toNumber
};
