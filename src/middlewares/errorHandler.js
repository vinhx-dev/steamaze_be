const { Prisma } = require("@prisma/client");
const { AppError } = require("../utils/AppError");
const { sendError } = require("../utils/response");
const { env } = require("../config/env");
const { MAX_IMAGE_LABEL } = require("../utils/validators");

// Dịch mọi lỗi kỹ thuật về AppError để client chỉ thấy message/code sạch
function normalizeError(err) {
  if (err instanceof AppError) {
    return err;
  }

  // Lỗi Prisma Known Request
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return AppError.conflict("Dữ liệu đã tồn tại", { fields: err.meta && err.meta.target });
      case "P2025":
        return AppError.notFound("Không tìm thấy dữ liệu yêu cầu");
      case "P2003":
        return AppError.conflict("Không thể thao tác: còn dữ liệu liên quan");
      case "P2011":
      case "P2012":
      case "P2019":
        return AppError.badRequest("Dữ liệu không hợp lệ hoặc thiếu trường bắt buộc");
      default:
        return new AppError("Lỗi cơ sở dữ liệu", 500, "DATABASE_ERROR", { prismaCode: err.code });
    }
  }

  // Lỗi Prisma Validation (truyền sai kiểu dữ liệu vào query)
  if (err instanceof Prisma.PrismaClientValidationError) {
    return AppError.badRequest("Dữ liệu truy vấn không hợp lệ", { reason: "prisma_validation" });
  }

  // Lỗi JWT
  if (err.name === "TokenExpiredError") {
    return AppError.unauthorized("Token đã hết hạn", "TOKEN_EXPIRED");
  }

  if (err.name === "JsonWebTokenError") {
    return AppError.unauthorized("Token không hợp lệ hoặc bị lỗi định dạng", "INVALID_TOKEN");
  }

  if (err.name === "NotBeforeError") {
    return AppError.unauthorized("Token chưa tới thời điểm có hiệu lực", "TOKEN_NOT_ACTIVE");
  }

  // Lỗi parse JSON body từ express.json()
  if (
    err.type === "entity.parse.failed" ||
    (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400) && "body" in err)
  ) {
    return AppError.badRequest("Body JSON không hợp lệ", { reason: "invalid_json" });
  }

  // Dữ liệu gửi lên vượt mức trần của express.json() (thường do ảnh quá lớn)
  if (err.type === "entity.too.large") {
    const limitMb = err.limit ? Math.round(err.limit / 1024 / 1024) : null;
    return new AppError(
      `Dữ liệu gửi lên quá lớn${limitMb ? ` (tối đa ${limitMb}MB)` : ""}. Ảnh tối đa ${MAX_IMAGE_LABEL}, vui lòng nén hoặc chọn ảnh nhẹ hơn.`,
      413,
      "PAYLOAD_TOO_LARGE",
      { limit: err.limit, length: err.length },
    );
  }

  const message = (err && err.message) || "Lỗi hệ thống";
  const statusCode = err && (err.statusCode || err.status) && typeof (err.statusCode || err.status) === "number"
    ? (err.statusCode || err.status)
    : 500;

  return new AppError(message, statusCode, "INTERNAL_ERROR");
}

function sanitizeBody(body) {
  if (!body || typeof body !== "object") return undefined;
  const sanitized = { ...body };
  const sensitiveKeys = ["password", "token", "refreshToken", "currentPassword", "newPassword", "credential", "accessToken"];
  for (const key of sensitiveKeys) {
    if (key in sanitized) {
      sanitized[key] = "[REDACTED]";
    }
  }
  return sanitized;
}

// Middleware bắt lỗi cuối cùng - express gọi theo thứ tự đăng ký, phải đặt sau tất cả route
function errorHandler(err, req, res, next) {
  const appError = normalizeError(err);

  // Lỗi 5xx: log stack trace và bối cảnh request rõ ràng để dễ debug
  if (appError.statusCode >= 500) {
    console.error(`[ERROR 500] ${req.method} ${req.originalUrl}:`, {
      name: err.name,
      message: err.message,
      stack: err.stack,
      body: sanitizeBody(req.body),
      query: req.query,
      headers: {
        authorization: req.headers.authorization ? "Bearer [REDACTED]" : undefined,
        cookie: req.headers.cookie ? "[REDACTED]" : undefined,
        origin: req.headers.origin,
      },
    });
  }

  // Production không trả lộ chi tiết lỗi nội bộ của hệ thống
  const message = env.isProduction && appError.statusCode >= 500
    ? "Đã có lỗi xảy ra, vui lòng thử lại"
    : appError.message;

  return sendError(res, message, appError.code, appError.details, appError.statusCode);
}

module.exports = { errorHandler, normalizeError };
