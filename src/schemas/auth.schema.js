const { z } = require("zod");

const usernameSchema = z
  .string({ error: "Tài khoản là bắt buộc" })
  .trim()
  .min(3, "Tài khoản phải dài tối thiểu 3 ký tự")
  .max(50, "Tài khoản tối đa 50 ký tự")
  .regex(/^[a-zA-Z0-9_]+$/, "Tài khoản chỉ được gồm chữ cái, chữ số hoặc dấu gạch dưới");

const passwordSchema = z
  .string({ error: "Mật khẩu là bắt buộc" })
  .min(8, "Mật khẩu phải từ 8 đến 72 ký tự")
  .max(72, "Mật khẩu phải từ 8 đến 72 ký tự");

const registerBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  gender: z.string().max(20).optional().nullable(),
});

const loginBodySchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

const googleLoginBodySchema = z.object({
  credential: z
    .string({ error: "Thiếu mã xác thực Google" })
    .min(20, "Mã xác thực Google không hợp lệ")
    .max(4096, "Mã xác thực Google không hợp lệ"),
});

const facebookLoginBodySchema = z.object({
  accessToken: z
    .string({ error: "Thiếu mã xác thực Facebook" })
    .min(20, "Mã xác thực Facebook không hợp lệ")
    .max(4096, "Mã xác thực Facebook không hợp lệ"),
});

module.exports = {
  usernameSchema,
  passwordSchema,
  registerBodySchema,
  loginBodySchema,
  googleLoginBodySchema,
  facebookLoginBodySchema,
};
