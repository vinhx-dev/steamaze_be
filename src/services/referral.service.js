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
 * Nhập mã của người khác: người nhập được cộng xu, mỗi tài khoản chỉ 1 lần
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

  // Điều kiện và cộng xu nằm trong cùng một câu lệnh, nên gửi song song cũng chỉ được 1 lần
  const [updatedUser] = await prisma.user.updateManyAndReturn({
    where: { id: userId, referralRedeemedAt: null },
    data: {
      referralRedeemedAt: new Date(),
      referredById: referrer.id,
      coins: { increment: REFERRAL_REWARD_COINS },
    },
    select: { coins: true },
  });

  if (!updatedUser) {
    throw AppError.conflict("Bạn đã nhập mã giới thiệu rồi");
  }

  return {
    coinsEarned: REFERRAL_REWARD_COINS,
    userCoins: updatedUser.coins,
    referredByUsername: referrer.username,
    message: `Nhập mã thành công, bạn được cộng ${REFERRAL_REWARD_COINS} xu!`,
  };
}

module.exports = { getMyReferral, redeemReferralCode };
