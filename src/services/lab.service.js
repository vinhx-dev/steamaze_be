const { prisma } = require("../config/db");
const { AppError } = require("../utils/AppError");
const jwt = require("jsonwebtoken");
const { env } = require("../config/env");
const { attachLessonTimeTag } = require("../utils/lesson");

// ---------------------------------------------------------------------------
// LAB / LESSONS (plugin HTML độc lập)
// ---------------------------------------------------------------------------

// Lấy danh sách bài học (dạng plugin + bài cũ). Trả ra cho frontend list
async function listLessons() {
  const lessons = await prisma.lesson.findMany({
    where: { published: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }, { name: "asc" }],
    // Không select html: danh sách không cần nội dung bài, mà html có thể
    // dài hàng chục KB. Giao diện chỉ cần id/tên/ảnh/slot/path.
    select: {
      id: true,
      name: true,
      slug: true,
      path: true,
      requiredSlots: true,
      published: true,
      comingSoon: true,
      order: true,
      imageUrl: true,
      roomId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // requiredSlots ở DB có thể là Json null -> chuẩn hoá thành []
  return lessons.map((lesson) =>
    attachLessonTimeTag({
      ...lesson,
      requiredSlots: Array.isArray(lesson.requiredSlots)
        ? lesson.requiredSlots.filter((s) => typeof s === "string")
        : [],
    })
  );
}

// Câu vào phòng thí nghiệm bằng slug. Chỉ kiểm tra bài tồn tại và đã xuất bản:
// người chơi được vào dù không mặc đồ, đồ đã mặc chỉ để vẽ lên cơ thể trong
// bài (xem requiredSlots ở listLessons).
async function enterLab(userId, slug, role = null) {
  if (!slug || typeof slug !== "string" || !slug.trim()) {
    throw AppError.badRequest("Slug bài học không hợp lệ");
  }

  const normalized = slug.trim().toLowerCase();

  const lesson = await prisma.lesson.findFirst({
    where: {
      slug: normalized,
      published: true,
      path: { not: null },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      path: true,
      requiredSlots: true,
      published: true,
      comingSoon: true,
    },
  });

  if (!lesson) {
    throw AppError.notFound("Không tìm thấy bài học thí nghiệm hoặc chưa được xuất bản");
  }

  // Bài đang khoá "Sắp ra mắt": chỉ admin được vào để kiểm tra
  if (lesson.comingSoon && role !== "ADMIN") {
    throw AppError.forbidden("Bài học này sắp ra mắt, bạn quay lại sau nhé!", {
      reason: "COMING_SOON",
    });
  }

  // Đồ đang mặc (DB = nguồn sự thật), luôn sort để client so sánh được với
  // localStorage mà không phải sort lại. Có thể rỗng, không sao.
  const equippedRows = await prisma.userItem.findMany({
    where: { userId, equipped: true },
    select: { itemId: true },
    orderBy: { itemId: "asc" },
  });

  const equippedIds = equippedRows.map((r) => r.itemId);

  // Tạo labToken: JWT riêng cho phiên chơi này, hạn ngắn 2h
  const labToken = jwt.sign(
    {
      sub: userId,
      lesson: {
        id: lesson.id,
        slug: lesson.slug,
        path: lesson.path,
      },
    },
    env.labSecret,
    { expiresIn: env.labTokenExpiresIn },
  );

  return {
    lessonPath: lesson.path,
    equipped: equippedIds,
    labToken,
  };
}

// Lưu kết quả từ bài học. Verify labToken, giới hạn 10KB, lưu LessonResult
const MAX_RESULT_BYTES = 10 * 1024; // 10KB

async function saveLabResult(userId, labToken, result) {
  let payload;

  try {
    payload = jwt.verify(labToken, env.labSecret);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw AppError.unauthorized("labToken đã hết hạn", "LAB_TOKEN_EXPIRED");
    }
    throw AppError.unauthorized("labToken không hợp lệ", "LAB_TOKEN_INVALID");
  }

  if (!payload || !payload.sub || !payload.lesson) {
    throw AppError.unauthorized("labToken không hợp lệ", "LAB_TOKEN_INVALID");
  }

  const tokenUserId = String(payload.sub);
  const expectedUserId = String(userId);

  if (tokenUserId !== expectedUserId) {
    throw AppError.forbidden("labToken không thuộc người dùng này", { reason: "USER_MISMATCH" });
  }

  const lessonId = String(payload.lesson.id || "");
  if (!lessonId) {
    throw AppError.badRequest("labToken thiếu thông tin bài học", { reason: "LESSON_MISSING" });
  }

  // Đảm bảo bài học tồn tại và đang là plugin (có slug/path)
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, slug: true, path: true, published: true },
  });

  if (!lesson || !lesson.published || !lesson.path) {
    throw AppError.badRequest("Bài học không hợp lệ để lưu kết quả", { lessonId });
  }

  // Giới hạn kích thước result (JSON). Serialize để đếm byte
  let resultJson = result;
  if (typeof result !== "object" || result === null) {
    // Bài học nên gửi object JSON, nhưng vẫn chấp nhận dạng khác dưới dạng value
    resultJson = result;
  }
  const serialized = JSON.stringify(resultJson);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
    throw AppError.badRequest("Kết quả bài học quá lớn (tối đa 10KB)", {
      maxBytes: MAX_RESULT_BYTES,
    });
  }

  // Lưu vào LessonResult
  const record = await prisma.lessonResult.create({
    data: {
      userId: expectedUserId,
      lessonId: lesson.id,
      result: resultJson,
    },
    select: {
      id: true,
      lessonId: true,
      result: true,
      createdAt: true,
    },
  });

  return record;
}

module.exports = {
  listLessons,
  enterLab,
  saveLabResult,
};
