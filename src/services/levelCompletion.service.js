const { prisma } = require("../config/db");
const { AppError } = require("../utils/AppError");

// ---------------------------------------------------------------------------
// LOGIC CHẤM "ĐÃ QUA MÀN"
//
// Tách riêng 1 file + 1 hàm để sau này thay bằng logic thật của game
// (chấm điểm màn chơi, đọc tiến độ, hoàn thành đủ số mục tiêu...) mà không
// đụng tới phần trao đồ.
//
// HIỆN TẠI mới chỉ là bản tối giản an toàn:
//   - bài học phải tồn tại và đang published
//   - bài học phải là màn chơi thường, không phải bài thí nghiệm hand tracking
//     (bài thí nghiệm nộp kết quả qua POST /api/lab/result)
//
// Chưa có phần trao đồ sau mỗi màn. Chỉnh hàm verifyLevelCompletion() là chỗ
// duy nhất cần đụng tới khi game có logic chấm điểm thật.
// ---------------------------------------------------------------------------

/** Bài học này có phải màn chơi thường (không yêu cầu đồ) không */
function isPlayableLevel(lesson) {
  return lesson.published && !lesson.comingSoon && !lesson.path;
}

/**
 * @returns {Promise<{ok: true, lesson: object} | {ok: false, code: string, message: string}>}
 */
async function verifyLevelCompletion(userId, lessonId) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      name: true,
      slug: true,
      path: true,
      published: true,
      comingSoon: true,
      roomId: true,
    },
  });

  if (!lesson) {
    return { ok: false, code: "LESSON_NOT_FOUND", message: "Không tìm thấy màn chơi" };
  }

  if (!isPlayableLevel(lesson)) {
    return {
      ok: false,
      code: "LESSON_NOT_COMPLETABLE",
      message: "Màn này không phải màn chơi thường, hãy hoàn thành trong phòng thí nghiệm",
    };
  }

  return { ok: true, lesson };
}

async function completeLevel(userId, lessonId, score) {
  const verdict = await verifyLevelCompletion(userId, lessonId);

  if (!verdict.ok) {
    if (verdict.code === "LESSON_NOT_FOUND") {
      throw AppError.notFound(verdict.message);
    }
    throw AppError.badRequest(verdict.message, { reason: verdict.code });
  }

  // Bắt buộc score là số trong khoảng 0 đến 100
  if (
    score === undefined ||
    score === null ||
    typeof score !== "number" ||
    Number.isNaN(score) ||
    score < 0 ||
    score > 100
  ) {
    throw AppError.badRequest("Điểm số (score) bắt buộc là một số từ 0 đến 100", { field: "score" });
  }

  // TODO: Hiện tại điểm số (score) do client tự báo nên chưa thể chống gian lận triệt để.
  // Hướng giải quyết đề xuất:
  // 1. Cấp sessionToken/labToken có chữ ký bí mật kèm timestamp bắt đầu khi người chơi nhấn vào bài học.
  // 2. Yêu cầu thời gian chơi tối thiểu (ví dụ: tối thiểu 60-90 giây) trước khi cho phép nộp kết quả.
  // 3. Client gửi kèm lịch sử sự kiện/hành động giải đố (action logs/seed) để server verify logic thay vì nhận score trực tiếp.
  if (score < 70) {
    throw AppError.badRequest("Chưa đạt yêu cầu hoàn thành bài học (cần đạt từ 70% trở lên).", {
      reason: "SCORE_BELOW_THRESHOLD",
      score,
      requiredScore: 70,
    });
  }

  // Kiểm tra xem người chơi đã từng nhận xu thưởng cho bài học này chưa
  const existingReward = await prisma.userLessonReward.findUnique({
    where: {
      userId_lessonId: {
        userId,
        lessonId,
      },
    },
  });

  if (existingReward) {
    // Đã nhận thưởng xu cho bài học này trước đó -> Không cộng thêm
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { coins: true },
    });

    return {
      rewards: [],
      coinsEarned: 0,
      alreadyRewarded: true,
      userCoins: currentUser ? currentUser.coins : 0,
      message: "Bạn đã nhận thưởng 1 xu cho bài học này trước đó.",
    };
  }

  // Lần đầu hoàn thành bài học: Cộng 1 xu duy nhất vào tài khoản người chơi
  const [, updatedUser] = await prisma.$transaction([
    prisma.userLessonReward.create({
      data: {
        userId,
        lessonId,
        coins: 1,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: {
        coins: { increment: 1 },
      },
      select: { coins: true },
    }),
  ]);

  return {
    rewards: [],
    coinsEarned: 1,
    alreadyRewarded: false,
    userCoins: updatedUser.coins,
    message: "Chúc mừng bạn đã hoàn thành bài học! +1 Xu đã được cộng vào tài khoản.",
  };
}

module.exports = { verifyLevelCompletion, completeLevel, isPlayableLevel };

