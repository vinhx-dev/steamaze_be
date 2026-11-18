const router = require("express").Router();

const referralController = require("../controllers/referral.controller");
const { requireAuth } = require("../middlewares/auth");
const { createRateLimit } = require("../middlewares/rateLimit");

// Chặn việc thử mã hàng loạt
const redeemRateLimit = createRateLimit({
  windowMs: 60_000,
  max: 10,
  message: "Bạn nhập mã quá nhanh, vui lòng thử lại sau",
});

router.get("/me", requireAuth, referralController.getMyReferral);
router.post("/redeem", requireAuth, redeemRateLimit, referralController.redeemReferralCode);

module.exports = router;
