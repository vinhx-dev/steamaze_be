const { prisma } = require("../config/db");
const { AppError } = require("../utils/AppError");
const {
  validateLessonName,
  validateOptionalImageUrl,
  validateLessonHtml,
  validateOrder,
} = require("../utils/validators");
const { LESSON_SELECT, LESSON_DETAIL_SELECT } = require("../utils/select");
const { getRoomById } = require("./room.service");
const { attachLessonTimeTag } = require("../utils/lesson");

const LESSON_ORDER_BY = [{ order: "asc" }, { createdAt: "asc" }];

async function listLessons(roomId, currentUser = null) {
  await getRoomById(roomId);

  const where = { roomId };
  if (currentUser?.role !== "ADMIN") {
    where.published = true;
  }

  const lessons = await prisma.lesson.findMany({
    where,
    select: LESSON_SELECT,
    orderBy: LESSON_ORDER_BY,
  });

  return lessons.map(attachLessonTimeTag);
}

// Chi tiết bài học, trả kèm mã html thuần để khung chạy
async function getLessonById(id, currentUser = null) {
  const lesson = await prisma.lesson.findUnique({
    where: { id },
    select: LESSON_DETAIL_SELECT,
  });

  if (!lesson) {
    throw AppError.notFound("Không tìm thấy bài học");
  }

  // Người dùng thường chỉ được xem bài học đã published, ADMIN được xem tất cả
  if (currentUser?.role !== "ADMIN" && !lesson.published) {
    throw AppError.notFound("Không tìm thấy bài học");
  }

  // Bài học đang khoá "Sắp ra mắt": người chơi không được mở (không trả html)
  if (currentUser?.role !== "ADMIN" && lesson.comingSoon) {
    throw AppError.forbidden("Bài học này sắp ra mắt, bạn quay lại sau nhé!", {
      reason: "COMING_SOON",
    });
  }

  return attachLessonTimeTag(lesson);
}

async function createLesson(roomId, { name, imageUrl, html, order, published, comingSoon }) {
  await getRoomById(roomId);

  const data = {
    roomId,
    name: validateLessonName(name),
    html: validateLessonHtml(html),
  };

  const image = validateOptionalImageUrl(imageUrl);
  if (image) {
    data.imageUrl = image;
  }

  const sortOrder = validateOrder(order);
  if (sortOrder !== undefined) {
    data.order = sortOrder;
  }

  if (published !== undefined) {
    data.published = Boolean(published);
  }

  if (comingSoon !== undefined) {
    data.comingSoon = Boolean(comingSoon);
  }

  const created = await prisma.lesson.create({
    data,
    select: LESSON_SELECT,
  });

  return attachLessonTimeTag(created);
}

async function updateLesson(id, payload) {
  await getLessonById(id, { role: "ADMIN" });

  const data = {};

  if (payload.name !== undefined) {
    data.name = validateLessonName(payload.name);
  }
  if (payload.imageUrl !== undefined) {
    const image = validateOptionalImageUrl(payload.imageUrl);
    data.imageUrl = image;
  }
  if (payload.html !== undefined) {
    data.html = validateLessonHtml(payload.html);
  }
  if (payload.order !== undefined) {
    const sortOrder = validateOrder(payload.order);
    data.order = sortOrder === undefined ? 0 : sortOrder;
  }
  if (payload.published !== undefined) {
    data.published = Boolean(payload.published);
  }
  if (payload.comingSoon !== undefined) {
    data.comingSoon = Boolean(payload.comingSoon);
  }

  if (Object.keys(data).length === 0) {
    throw AppError.badRequest("Không có trường nào để cập nhật");
  }

  const updated = await prisma.lesson.update({
    where: { id },
    data,
    select: LESSON_DETAIL_SELECT,
  });

  return attachLessonTimeTag(updated);
}

async function deleteLesson(id) {
  const existing = await prisma.lesson.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw AppError.notFound("Không tìm thấy bài học");
  }

  await prisma.lesson.delete({ where: { id } });
  return { id };
}

module.exports = {
  listLessons,
  getLessonById,
  createLesson,
  updateLesson,
  deleteLesson,
};
