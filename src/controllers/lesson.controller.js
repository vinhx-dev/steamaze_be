const lessonService = require("../services/lesson.service");
const labService = require("../services/lab.service");
const { sendSuccess, sendCreated } = require("../utils/response");
const { withServedImage, dropUnchangedServedImage } = require("../utils/servedImage");

// Ảnh Base64 -> đường dẫn /api/images/lessons/... (xem utils/servedImage.js)
const served = (data) => withServedImage("lessons", data);

async function listLessons(req, res) {
  const lessons = await lessonService.listLessons(req.params.roomId, req.user);
  return sendSuccess(res, served(lessons), "Danh sách bài học của phòng");
}

// Danh sách cho trang /lessons: bài đã xuất bản kèm slot đồ bắt buộc và
// path tới file plugin. Khác với listLessons ở trên là không lọc theo phòng.
async function listLabLessons(req, res) {
  const lessons = await labService.listLessons();
  return sendSuccess(res, served(lessons), "Danh sách bài học");
}

async function getLesson(req, res) {
  const lesson = await lessonService.getLessonById(req.params.id, req.user);
  return sendSuccess(res, served(lesson), "Thông tin bài học");
}

async function createLesson(req, res) {
  const { name, imageUrl, html, order, published, comingSoon, firstPlayCoins, replayCoins } = req.body || {};
  const lesson = await lessonService.createLesson(req.params.roomId, {
    name,
    imageUrl,
    html,
    order,
    published,
    comingSoon,
    firstPlayCoins,
    replayCoins,
  });

  return sendCreated(res, served(lesson), "Thêm bài học thành công");
}

async function updateLesson(req, res) {
  const lesson = await lessonService.updateLesson(
    req.params.id,
    dropUnchangedServedImage(req.body, "imageUrl"),
  );
  return sendSuccess(res, served(lesson), "Cập nhật bài học thành công");
}

async function deleteLesson(req, res) {
  const result = await lessonService.deleteLesson(req.params.id);
  return sendSuccess(res, result, "Đã xoá bài học");
}

module.exports = {
  listLessons,
  listLabLessons,
  getLesson,
  createLesson,
  updateLesson,
  deleteLesson,
};
