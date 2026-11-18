const { prisma } = require("../config/db");
const { AppError } = require("../utils/AppError");

const REFERRAL_REWARD_COINS = 20;
const REFERRAL_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

/**
 * Lấy mã giới thiệu của người dùng và trạng thái đã nhập mã hay chưa
 */
async function getMyReferral(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      referralCode: true,
      referralRedeemedAt: true,
      referredBy: { select: { username: true } },
    },
  });

  if (!user) {
    throw AppError.notFound("Không tìm thấy người dùng");
  }

  return {
    code: user.referralCode,
    rewardCoins: REFERRAL_REWARD_COINS,
    hasRedeemed: Boolean(user.referralRedeemedAt),
    referredByUsername: user.referredBy?.username ?? null,
  };
}

/**
 * Nhập mã của người khác: người nhập và chủ mã cùng được cộng xu.
 * Mỗi tài khoản chỉ nhập 1 lần, chủ mã được thưởng không giới hạn số người nhập.
 */
async function redeemReferralCode(userId, rawCode) {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!REFERRAL_CODE_PATTERN.test(code)) {
    throw AppError.badRequest("Mã giới thiệu không hợp lệ", { field: "code" });
  }

  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true, username: true },
  });

  if (!referrer) {
    throw AppError.notFound("Mã giới thiệu không tồn tại");
  }
  if (referrer.id === userId) {
    throw AppError.badRequest("Bạn không thể nhập mã của chính mình", { field: "code" });
  }

  const updatedUser = await prisma.$transaction(async (tx) => {
    // Khoá 2 tài khoản theo thứ tự cố định để 2 người nhập mã của nhau cùng lúc không bị kẹt
    const lockedUsers = await tx.$queryRaw`
      SELECT "id" FROM "users"
      WHERE "id" IN (${userId}, ${referrer.id})
      ORDER BY "id"
      FOR UPDATE
    `;
    if (lockedUsers.length !== 2) {
      throw AppError.notFound("Mã giới thiệu không tồn tại");
    }

    // Điều kiện và cộng xu nằm trong cùng một câu lệnh, nên gửi song song cũng chỉ được 1 lần
    const [redeemer] = await tx.user.updateManyAndReturn({
      where: { id: userId, referralRedeemedAt: null },
      data: {
        referralRedeemedAt: new Date(),
        referredById: referrer.id,
        coins: { increment: REFERRAL_REWARD_COINS },
      },
      select: { coins: true },
    });

    if (!redeemer) {
      throw AppError.conflict("Bạn đã nhập mã giới thiệu rồi");
    }

    await tx.user.update({
      where: { id: referrer.id },
      data: { coins: { increment: REFERRAL_REWARD_COINS } },
      select: { id: true },
    });

    return redeemer;
  });

  return {
    coinsEarned: REFERRAL_REWARD_COINS,
    userCoins: updatedUser.coins,
    referredByUsername: referrer.username,
    message: `Nhập mã thành công, bạn được cộng ${REFERRAL_REWARD_COINS} xu!`,
  };
}

module.exports = { getMyReferral, redeemReferralCode };
