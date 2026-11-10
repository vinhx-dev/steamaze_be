const { AppError } = require("./AppError");

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,50}$/;
const MIN_PASSWORD_LENGTH = 6;

function validateUsername(username) {
  if (!USERNAME_PATTERN.test(username || "")) {
    throw AppError.badRequest("Tài khoản phải gồm chữ, số hoặc dấu gạch dưới, dài 3-50 ký tự", {
      field: "username",
    });
  }
  return username;
}

function validatePassword(password) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw AppError.badRequest(`Mật khẩu tối thiểu ${MIN_PASSWORD_LENGTH} ký tự`, { field: "password" });
  }
  return password;
}

// Ảnh Base64 tải lên: chỉ nhận các định dạng ảnh phổ biến.
// Giới hạn tính theo dung lượng ẢNH GỐC (sau khi giải mã Base64), tối đa 500KB.
// Base64 dài hơn ảnh gốc khoảng 1,33 lần, nên chuỗi gửi lên tối đa ~667KB.
const DATA_IMAGE_PATTERN = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
const MAX_IMAGE_BYTES = 500 * 1024;
const MAX_IMAGE_LABEL = "500KB";

// Dung lượng thật của ảnh nằm trong chuỗi data:image/...;base64,xxx
function getDataImageBytes(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = dataUrl.slice(commaIndex + 1).replace(/\s/g, "");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function validateDataImage(dataUrl, field) {
  if (!DATA_IMAGE_PATTERN.test(dataUrl)) {
    throw AppError.badRequest("Ảnh tải lên phải là PNG, JPG, WEBP, GIF hoặc SVG", { field });
  }
  const bytes = getDataImageBytes(dataUrl);
  if (bytes > MAX_IMAGE_BYTES) {
    throw AppError.badRequest(
      `Ảnh tải lên nặng ${Math.ceil(bytes / 1024)}KB, vượt quá ${MAX_IMAGE_LABEL}. Vui lòng nén hoặc chọn ảnh nhẹ hơn.`,
      { field, maxBytes: MAX_IMAGE_BYTES, bytes },
    );
  }
  return dataUrl;
}

function validateImageUrl(imageUrl, field = "imageUrl", { allowDataImage = false } = {}) {
  if (!imageUrl || typeof imageUrl !== "string") {
    throw AppError.badRequest(`Thiếu đường dẫn ${field}`, { field });
  }
  const trimmed = imageUrl.trim();
  if (trimmed.length === 0) {
    throw AppError.badRequest(`Đường dẫn ${field} không được để trống`, { field });
  }
  // inventoryAvatarUrl tạm thời hỗ trợ base64 trước khi chuyển sang lưu file riêng
  if (field === "inventoryAvatarUrl" && trimmed.startsWith("data:")) {
    return validateDataImage(trimmed, field);
  }
  if (allowDataImage && trimmed.startsWith("data:")) {
    return validateDataImage(trimmed, field);
  }
  if (trimmed.length > 2000) {
    throw AppError.badRequest(`Đường dẫn ${field} tối đa 2000 ký tự`, { field });
  }
  const isHttp = /^https?:\/\//i.test(trimmed);
  const isRelative = trimmed.startsWith("/");
  if (!isHttp && !isRelative) {
    throw AppError.badRequest(
      `Đường dẫn ${field} không hợp lệ. Chỉ chấp nhận URL http(s):// hoặc đường dẫn bắt đầu bằng "/"`,
      { field }
    );
  }
  return trimmed;
}

// Ngày không hợp lệ sẽ tạo ra Invalid Date, cần chặn trước khi xuống tầng DB
function validateCapturedAt(capturedAt) {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) {
    throw AppError.badRequest("Thời gian không hợp lệ, dùng định dạng ISO 8601", { field: "capturedAt" });
  }
  return date;
}

// Tên nhóm: 2-100 ký tự, không chỉ toàn khoảng trắng
function validateGroupName(name) {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw AppError.badRequest("Tên nhóm phải có ít nhất 2 ký tự", { field: "name" });
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) {
    throw AppError.badRequest("Tên nhóm không được vượt quá 100 ký tự", { field: "name" });
  }
  return trimmed;
}

// Từ khoá tìm bạn: 1-50 ký tự, chỉ chữ/số/gạch dưới để tránh truy vấn rác
function validateSearchKeyword(keyword) {
  if (typeof keyword !== "string" || keyword.trim().length < 1) {
    throw AppError.badRequest("Vui lòng nhập từ khoá tìm kiếm", { field: "keyword" });
  }
  const trimmed = keyword.trim();
  if (trimmed.length > 50) {
    throw AppError.badRequest("Từ khoá tìm kiếm không được vượt quá 50 ký tự", { field: "keyword" });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    throw AppError.badRequest("Từ khoá chỉ được gồm chữ, số hoặc dấu gạch dưới", { field: "keyword" });
  }
  return trimmed;
}

// Tên phòng: 2-100 ký tự, không chỉ toàn khoảng trắng
function validateRoomName(name) {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw AppError.badRequest("Tên phòng phải có ít nhất 2 ký tự", { field: "name" });
  }
  const trimmed = name.trim();
  if (trimmed.length > 100) {
    throw AppError.badRequest("Tên phòng không được vượt quá 100 ký tự", { field: "name" });
  }
  return trimmed;
}

// Tên bài học: 2-150 ký tự
function validateLessonName(name) {
  if (typeof name !== "string" || name.trim().length < 2) {
    throw AppError.badRequest("Tên bài học phải có ít nhất 2 ký tự", { field: "name" });
  }
  const trimmed = name.trim();
  if (trimmed.length > 150) {
    throw AppError.badRequest("Tên bài học không được vượt quá 150 ký tự", { field: "name" });
  }
  return trimmed;
}

// Ảnh không bắt buộc: để trống hoặc gửi null nghĩa là dùng ảnh mặc định.
// Cho phép ảnh Base64 vì chỉ admin dùng (phòng, bài học, tin tức).
function validateOptionalImageUrl(imageUrl, field = "imageUrl") {
  if (imageUrl === undefined || imageUrl === null) {
    return null;
  }
  if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
    return null;
  }
  return validateImageUrl(imageUrl, field, { allowDataImage: true });
}

const USER_ROLES = ["ADMIN", "MEMBER"];
const USER_GENDERS = ["MALE", "FEMALE", "OTHER"];

function validateRole(role) {
  const value = String(role || "").trim().toUpperCase();
  if (!USER_ROLES.includes(value)) {
    throw AppError.badRequest("Vai trò chỉ được là ADMIN hoặc MEMBER", { field: "role" });
  }
  return value;
}

// Giới tính không bắt buộc: rỗng/null nghĩa là chưa rõ
function validateGender(gender) {
  if (gender === undefined || gender === null || gender === "") {
    return null;
  }
  const value = String(gender).trim().toUpperCase();
  if (!USER_GENDERS.includes(value)) {
    throw AppError.badRequest("Giới tính chỉ được là MALE, FEMALE hoặc OTHER", { field: "gender" });
  }
  return value;
}

// HTML bài học do admin dán vào, cho phép để trống rồi bổ sung sau.
// Không giới hạn độ dài HTML, chỉ giới hạn ảnh.
function validateLessonHtml(html) {
  if (html === undefined || html === null) {
    return "";
  }
  if (typeof html !== "string") {
    throw AppError.badRequest("Nội dung HTML phải là chuỗi", { field: "html" });
  }
  return html;
}

// Thứ tự hiển thị: số nguyên từ 0 trở lên
function validateOrder(order) {
  if (order === undefined || order === null) {
    return undefined;
  }
  const value = Number(order);
  if (!Number.isInteger(value) || value < 0) {
    throw AppError.badRequest("Thứ tự hiển thị phải là số nguyên từ 0 trở lên", { field: "order" });
  }
  return value;
}

// Số xu thưởng: số nguyên từ 0 trở lên
function validateCoinReward(coins, field = "coins", defaultValue = undefined) {
  if (coins === undefined || coins === null) {
    return defaultValue;
  }
  if (typeof coins === "boolean" || (typeof coins === "string" && coins.trim() === "")) {
    throw AppError.badRequest(`Số xu thưởng (${field}) phải là số nguyên từ 0 trở lên`, { field });
  }
  const value = Number(coins);
  if (!Number.isInteger(value) || value < 0) {
    throw AppError.badRequest(`Số xu thưởng (${field}) phải là số nguyên từ 0 trở lên`, { field });
  }
  return value;
}

function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateArticleTitle(title) {
  if (typeof title !== "string" || title.trim().length < 3) {
    throw AppError.badRequest("Tiêu đề bài viết phải có ít nhất 3 ký tự", { field: "title" });
  }
  const trimmed = title.trim();
  if (trimmed.length > 255) {
    throw AppError.badRequest("Tiêu đề bài viết không được vượt quá 255 ký tự", { field: "title" });
  }
  return trimmed;
}

function validateArticleSlug(slug, fallbackTitle) {
  const candidate = slug && typeof slug === "string" && slug.trim() ? slug.trim() : slugify(fallbackTitle);
  if (!candidate || candidate.length < 3) {
    throw AppError.badRequest("Slug bài viết phải có ít nhất 3 ký tự", { field: "slug" });
  }
  const clean = candidate.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  if (clean.length > 150) {
    return clean.slice(0, 150);
  }
  return clean;
}

function validateArticleExcerpt(excerpt) {
  if (typeof excerpt !== "string" || excerpt.trim().length < 5) {
    throw AppError.badRequest("Tóm tắt bài viết phải có ít nhất 5 ký tự", { field: "excerpt" });
  }
  return excerpt.trim();
}

function validateArticleContent(content) {
  if (typeof content !== "string" || content.trim().length < 10) {
    throw AppError.badRequest("Nội dung bài viết phải có ít nhất 10 ký tự", { field: "content" });
  }
  return content.trim();
}

function validateArticleCategory(category) {
  if (!category || typeof category !== "string") {
    return "TIN TỨC";
  }
  const clean = category.trim().toUpperCase();
  const validCategories = ["TIN TỨC", "KHÁM PHÁ", "CỘNG ĐỒNG", "SỰ KIỆN", "HƯỚNG DẪN"];
  if (validCategories.includes(clean)) {
    return clean;
  }
  return "TIN TỨC";
}

function validateArticleTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags
      .map((t) => String(t).trim().replace(/^#/, ""))
      .filter((t) => t.length > 0 && t.length <= 50)
      .slice(0, 10);
  }
  if (typeof tags === "string") {
    return tags
      .split(/[,;\n]+/)
      .map((t) => t.trim().replace(/^#/, ""))
      .filter((t) => t.length > 0 && t.length <= 50)
      .slice(0, 10);
  }
  return [];
}

module.exports = {
  validateUsername,
  validatePassword,
  validateImageUrl,
  validateCapturedAt,
  validateGroupName,
  validateSearchKeyword,
  validateRoomName,
  validateLessonName,
  validateOptionalImageUrl,
  validateRole,
  validateGender,
  validateLessonHtml,
  validateOrder,
  validateCoinReward,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LABEL,
  slugify,
  validateArticleTitle,
  validateArticleSlug,
  validateArticleExcerpt,
  validateArticleContent,
  validateArticleCategory,
  validateArticleTags,
};

