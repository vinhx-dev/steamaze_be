const referralService = require("../services/referral.service");
const { sendSuccess } = require("../utils/response");

async function getMyReferral(req, res) {
  const referral = await referralService.getMyReferral(req.user.id);
  return sendSuccess(res, referral, "Thông tin mã giới thiệu");
}

async function redeemReferralCode(req, res) {
  const result = await referralService.redeemReferralCode(req.user.id, req.body?.code);
  return sendSuccess(res, result, result.message);
}

module.exports = { getMyReferral, redeemReferralCode };
