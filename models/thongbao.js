
const mongoose = require('mongoose');

const thongbaoSchema = new mongoose.Schema({
  title: String,
  startDate: Date,
  endDate: Date,
  description: String,
  notified: { type: Boolean, default: false }
});

// Dòng export - cần đổi tên model ở đây
module.exports = mongoose.model('thongbao', thongbaoSchema); 