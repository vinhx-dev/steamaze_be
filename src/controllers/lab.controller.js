const labService = require("../services/lab.service");
const { sendSuccess } = require("../utils/response");
const { AppError } = require("../utils/AppError");

// POST /api/lab/enter/:slug -> kiểm tra đồ, trả lessonPath + equipped + labToken
async function enterLab(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    throw AppError.unauthorized("Chưa đăng nhập", "UNAUTHORIZED");
  }
  const result = await labService.enterLab(userId, req.params.slug, req.user?.role);
  return sendSuccess(res, result, "Vào phòng thí nghiệm thành công");
}

// POST /api/lab/result { labToken, result } -> lưu LessonResult
async function saveResult(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    throw AppError.unauthorized("Chưa đăng nhập", "UNAUTHORIZED");
  }
  const { labToken, result } = req.body || {};
  if (!labToken) {
    throw AppError.badRequest("Thiếu labToken", { field: "labToken" });
  }
  const record = await labService.saveLabResult(userId, labToken, result);
  return sendSuccess(res, record, "Đã lưu kết quả");
}

module.exports = { enterLab, saveResult };
