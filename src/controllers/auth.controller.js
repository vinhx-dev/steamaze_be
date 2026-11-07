const authService = require("../services/auth.service");
const { sendCreated, sendSuccess } = require("../utils/response");
const { AppError } = require("../utils/AppError");
const { env } = require("../config/env");

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "lax",
  path: "/api/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
};

async function register(req, res) {
  const { username, password, gender } = req.body || {};
  const result = await authService.register({ username, password, gender });

  if (result.refreshToken) {
    res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS);
  }

  return sendCreated(res, result, "Đăng ký thành công");
}

async function login(req, res) {
  const { username, password } = req.body || {};
  const result = await authService.login({ username, password });

  if (result.refreshToken) {
    res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS);
  }

  return sendSuccess(res, result, "Đăng nhập thành công");
}

async function me(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    throw AppError.unauthorized("Chưa đăng nhập", "UNAUTHORIZED");
  }
  const user = await authService.getMe(userId);
  return sendSuccess(res, user, "Thông tin tài khoản");
}

async function refresh(req, res) {
  const targetToken = req.cookies?.refreshToken || req.body?.refreshToken;
  const result = await authService.refreshToken(targetToken);

  if (result.refreshToken) {
    res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS);
  }

  return sendSuccess(res, result, "Làm mới phiên đăng nhập thành công");
}

async function googleLogin(req, res) {
  const { credential } = req.body || {};
  const result = await authService.loginWithGoogle(credential);

  if (result.refreshToken) {
    res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS);
  }

  return sendSuccess(res, result, "Đăng nhập Google thành công");
}

async function facebookLogin(req, res) {
  const { accessToken } = req.body || {};
  const result = await authService.loginWithFacebook(accessToken);

  if (result.refreshToken) {
    res.cookie("refreshToken", result.refreshToken, REFRESH_COOKIE_OPTIONS);
  }

  return sendSuccess(res, result, "Đăng nhập Facebook thành công");
}

module.exports = { register, login, me, refresh, googleLogin, facebookLogin };
