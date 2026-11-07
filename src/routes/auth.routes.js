const router = require("express").Router();
const authController = require("../controllers/auth.controller");
const { requireAuth } = require("../middlewares/auth");
const { createRateLimit } = require("../middlewares/rateLimiter");
const { validate } = require("../middlewares/validate");
const { registerBodySchema, loginBodySchema, googleLoginBodySchema, facebookLoginBodySchema } = require("../schemas/auth.schema");

// Giới hạn 10 lần gọi trong 15 phút theo IP để chống brute-force đăng nhập / spam đăng ký
const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Bạn đã thử quá nhiều lần. Vui lòng đợi 15 phút trước khi thử lại.",
});

// Giới hạn 30 lần gọi trong 15 phút theo IP cho đăng nhập bằng Google
const googleRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Bạn đã thử đăng nhập Google quá nhiều lần. Vui lòng đợi 15 phút trước khi thử lại.",
});

// Giới hạn 30 lần gọi trong 15 phút theo IP cho đăng nhập bằng Facebook
const facebookRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Bạn đã thử đăng nhập Facebook quá nhiều lần. Vui lòng đợi 15 phút trước khi thử lại.",
});

// Giới hạn thêm theo TÊN TÀI KHOẢN: kẻ tấn công đổi IP liên tục (botnet, proxy)
// vẫn chỉ thử được 20 mật khẩu / 15 phút cho mỗi tài khoản
const loginPerAccountRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Tài khoản này bị thử đăng nhập sai quá nhiều lần. Vui lòng đợi 15 phút rồi thử lại.",
  key: (req) => {
    const username = req.body && req.body.username;
    return typeof username === "string" && username.trim()
      ? `user:${username.trim().toLowerCase()}`
      : null;
  },
});

router.post("/register", authRateLimit, validate({ body: registerBodySchema }), authController.register);
router.post(
  "/login",
  authRateLimit,
  loginPerAccountRateLimit,
  validate({ body: loginBodySchema }),
  authController.login,
);
router.post(
  "/google",
  googleRateLimit,
  validate({ body: googleLoginBodySchema }),
  authController.googleLogin,
);
router.post(
  "/facebook",
  facebookRateLimit,
  validate({ body: facebookLoginBodySchema }),
  authController.facebookLogin,
);
router.post("/refresh", authController.refresh);
router.get("/me", requireAuth, authController.me);

module.exports = router;
