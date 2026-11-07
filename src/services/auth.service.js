const { OAuth2Client } = require("google-auth-library");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../utils/AppError");
const { hashPassword, comparePassword } = require("../utils/password");
const { signToken, signRefreshToken, verifyRefreshToken } = require("../utils/token");
const { validateUsername, validatePassword, validateGender, validateImageUrl } = require("../utils/validators");
const { USER_PUBLIC_SELECT } = require("../utils/select");
const { recordUserLoginAndStreak } = require("./streak.service");

// Khởi tạo OAuth2Client dùng chung ở module scope
const googleClient = new OAuth2Client();

function generateBaseUsername(email) {
  const localPart = String(email || "").split("@")[0] || "";
  // Bỏ dấu tiếng Việt
  const normalized = localPart
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  // Chỉ giữ [a-zA-Z0-9_]
  let cleaned = normalized.replace(/[^a-zA-Z0-9_]/g, "");
  // Ngắn hơn 3 thì thêm "user", tối đa 40 ký tự
  if (cleaned.length < 3) {
    cleaned = (cleaned + "user").slice(0, 40);
  } else if (cleaned.length > 40) {
    cleaned = cleaned.slice(0, 40);
  }
  if (cleaned.length < 3) {
    cleaned = cleaned.padEnd(3, "0");
  }
  return cleaned;
}

// ----- Ảnh đại diện Google -----
// Chỉ tải từ máy chủ ảnh của Google (chặn việc lợi dụng server đi tải link lạ)
const GOOGLE_AVATAR_HOST = /(^|\.)googleusercontent\.com$/i;
const GOOGLE_AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const GOOGLE_AVATAR_MAX_BYTES = 300 * 1024;   // dưới mức 500KB của hệ thống
const GOOGLE_AVATAR_SIZE = 256;               // nhờ Google thu nhỏ sẵn về 256x256

/**
 * Tải ảnh đại diện Google về, xử lý sơ bộ rồi đổi thành chuỗi base64 để lưu như ảnh người dùng tự tải lên
 * (không phụ thuộc link Google: link có thể hết hạn hoặc đổi). Lỗi gì cũng trả null, không chặn đăng nhập.
 */
async function fetchGoogleAvatar(pictureUrl) {
  try {
    if (typeof pictureUrl !== "string" || !pictureUrl) return null;
    const url = new URL(pictureUrl);
    if (url.protocol !== "https:" || !GOOGLE_AVATAR_HOST.test(url.hostname)) return null;
    // Link Google dạng ...=s96-c: đổi tham số cỡ để lấy ảnh vuông 256px, nét hơn mà vẫn nhẹ
    url.pathname = url.pathname.replace(/=[^/]*$/, "") + `=s${GOOGLE_AVATAR_SIZE}-c`;

    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!GOOGLE_AVATAR_TYPES.has(type)) return null;
    const declared = Number(res.headers.get("content-length")) || 0;
    if (declared > GOOGLE_AVATAR_MAX_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100 || buf.length > GOOGLE_AVATAR_MAX_BYTES) return null;
    const dataUrl = `data:${type};base64,${buf.toString("base64")}`;
    // Qua đúng bộ kiểm tra ảnh mà trang Hồ sơ đang dùng
    return validateImageUrl(dataUrl, "avatarUrl", { allowDataImage: true });
  } catch (err) {
    console.warn("[google-login] Không lấy được ảnh đại diện Google:", err && err.message);
    return null;
  }
}

function buildTokenPayload(user) {
  return {
    sub: user.id,
    role: user.role,
    tokenVersion: user.tokenVersion ?? 0,
  };
}

async function register({ username, password, gender }) {
  validateUsername(username);
  validatePassword(password);
  // Chỉ nhận MALE / FEMALE / OTHER, giá trị lạ trả lỗi 400 thay vì lỗi cơ sở dữ liệu
  const cleanGender = validateGender(gender);

  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (existing) {
    throw AppError.conflict("Tài khoản đã tồn tại", { field: "username" });
  }

  const user = await prisma.user.create({
    data: {
      username,
      password: await hashPassword(password),
      // Ảnh đại diện không nhận lúc đăng ký: đặt sau ở trang Hồ sơ (có kiểm tra loại ảnh, 500KB)
      avatarUrl: null,
      gender: cleanGender,
      role: "MEMBER",
      tokenVersion: 0,
    },
    select: { ...USER_PUBLIC_SELECT, tokenVersion: true },
  });

  const payload = buildTokenPayload(user);
  const { tokenVersion, ...safeUser } = user;
  return {
    user: safeUser,
    token: signToken(payload), // 3h
    refreshToken: signRefreshToken(payload), // 7d
  };
}

async function login({ username, password }) {
  const record = await prisma.user.findUnique({ where: { username } });

  // Cùng một thông báo cho cả "không có user", "sai mật khẩu", lẫn "tài khoản Google không có mật khẩu"
  const invalidCredentials = AppError.unauthorized(
    "Tài khoản hoặc mật khẩu không đúng",
    "INVALID_CREDENTIALS"
  );

  if (!record || !record.password) {
    throw invalidCredentials;
  }

  const passwordMatches = await comparePassword(password, record.password);
  if (!passwordMatches) {
    throw invalidCredentials;
  }

  // Duy trì chuỗi đăng nhập cho user và cho nhóm
  const streakInfo = await recordUserLoginAndStreak(record.id);

  const { password: hashedPassword, googleId: _gid, tokenVersion, ...user } = record;
  if (streakInfo) {
    user.streak = streakInfo.streak;
    user.lastLoginDate = streakInfo.lastLoginDate;
  }
  const payload = buildTokenPayload(record);

  return {
    user,
    token: signToken(payload), // 3h
    refreshToken: signRefreshToken(payload), // 7d
  };
}

async function getMe(userId) {
  // Duy trì chuỗi đăng nhập cho user và cho nhóm
  await recordUserLoginAndStreak(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...USER_PUBLIC_SELECT,
      _count: { select: { journalImages: true } },
      groupMemberships: {
        select: {
          role: true,
          group: {
            select: { id: true, name: true, ownerId: true },
          },
        },
      },
    },
  });

  if (!user) {
    throw AppError.notFound("Không tìm thấy người dùng");
  }

  const membership = user.groupMemberships?.[0] || null;
  const group = membership
    ? {
        id: membership.group.id,
        name: membership.group.name,
        role: membership.role,
        isOwner: membership.role === "OWNER",
      }
    : null;

  const { groupMemberships, ...userData } = user;
  return { ...userData, group };
}

async function refreshToken(tokenString) {
  if (!tokenString) {
    throw AppError.unauthorized("Thiếu refresh token", "INVALID_REFRESH_TOKEN");
  }

  let decoded;
  try {
    decoded = verifyRefreshToken(tokenString);
  } catch (err) {
    throw AppError.unauthorized("Refresh token đã hết hạn hoặc không hợp lệ", "EXPIRED_REFRESH_TOKEN");
  }

  const userId = decoded.sub || decoded.id || decoded.userId;
  if (!userId) {
    throw AppError.unauthorized("Refresh token không hợp lệ", "INVALID_REFRESH_TOKEN");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...USER_PUBLIC_SELECT, tokenVersion: true },
  });

  if (!user) {
    throw AppError.unauthorized("Người dùng không tồn tại", "USER_NOT_FOUND");
  }

  // Chống token cũ sau khi đổi mật khẩu / đổi quyền
  if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.tokenVersion) {
    throw AppError.unauthorized("Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại", "TOKEN_REVOKED");
  }

  const payload = buildTokenPayload(user);
  const { tokenVersion, ...safeUser } = user;
  return {
    user: safeUser,
    token: signToken(payload), // 3h
    refreshToken: signRefreshToken(payload), // 7d
  };
}

async function loginWithGoogle(credential) {
  if (!env.googleClientId) {
    throw new AppError("Chưa cấu hình đăng nhập Google", 503, "GOOGLE_AUTH_NOT_CONFIGURED");
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: env.googleClientId,
    });
  } catch (err) {
    throw AppError.unauthorized("Đăng nhập Google không hợp lệ", "INVALID_GOOGLE_TOKEN");
  }

  const p = ticket ? ticket.getPayload() : null;
  if (!p || p.email_verified !== true || !p.sub || !p.email) {
    throw AppError.unauthorized("Đăng nhập Google không hợp lệ", "INVALID_GOOGLE_TOKEN");
  }

  const normalizedEmail = String(p.email).trim().toLowerCase();

  let user = await prisma.user.findUnique({
    where: { googleId: p.sub },
  });

  if (user) {
    // Có -> đăng nhập. Nếu email trong token khác email đang lưu thì cập nhật email
    if (normalizedEmail && user.email !== normalizedEmail) {
      try {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { email: normalizedEmail },
        });
      } catch (err) {
        // Email mới trùng với tài khoản khác: giữ email cũ, vẫn cho đăng nhập (googleId mới là khoá định danh)
        if (!(err && err.code === "P2002")) throw err;
        console.warn("[google-login] Không cập nhật được email do trùng, userId:", user.id);
      }
    }
  } else {
    // Không có -> tạo tài khoản mới
    const baseUsername = generateBaseUsername(normalizedEmail);
    // Chỉ lấy ảnh Google lúc TẠO tài khoản. Về sau người dùng tự đổi (hoặc xoá) ảnh ở trang Hồ sơ
    // thì giữ theo lựa chọn đó, đăng nhập lại không ghi đè bằng ảnh Google nữa.
    const googleAvatar = await fetchGoogleAvatar(p.picture);
    let created = false;

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = attempt === 0
        ? baseUsername
        : `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

      validateUsername(candidate);

      try {
        user = await prisma.user.create({
          data: {
            username: candidate,
            email: normalizedEmail,
            googleId: p.sub,
            password: null,
            role: "MEMBER",
            tokenVersion: 0,
            avatarUrl: googleAvatar,
            gender: null,
          },
        });
        created = true;
        break;
      } catch (err) {
        if (err && err.code === "P2002") {
          const target = Array.isArray(err.meta?.target)
            ? err.meta.target.join(",")
            : String(err.meta?.target || "");

          if (target.includes("email")) {
            throw AppError.conflict("Email này đã gắn với một tài khoản khác", { field: "email" });
          }
          if (target.includes("googleId")) {
            user = await prisma.user.findUnique({ where: { googleId: p.sub } });
            if (user) {
              created = true;
              break;
            }
          }
          // Trùng username -> tiếp tục thử với số ngẫu nhiên
          continue;
        }
        throw err;
      }
    }

    if (!created) {
      throw AppError.conflict("Không thể tạo tên tài khoản tự động, vui lòng thử lại sau");
    }
  }

  // Duy trì chuỗi đăng nhập cho user và cho nhóm
  const streakInfo = await recordUserLoginAndStreak(user.id);

  const { password: hashedPassword, googleId: _gid, facebookId: _fid, tokenVersion, ...safeUser } = user;
  if (streakInfo) {
    safeUser.streak = streakInfo.streak;
    safeUser.lastLoginDate = streakInfo.lastLoginDate;
  }
  const payload = buildTokenPayload(user);

  return {
    user: safeUser,
    token: signToken(payload), // 3h
    refreshToken: signRefreshToken(payload), // 7d
  };
}

// Bỏ dấu tiếng Việt và viết thường: "Nguyễn Thị Hoa" -> "nguyen thi hoa"
function removeVietnameseTones(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

// ----- Sinh tên tài khoản Facebook từ tên hiển thị -----
// Bỏ dấu, viết liền, chỉ giữ [a-z0-9_], dài 3-40 ký tự
function generateBaseUsernameFromName(name) {
  const cleaned = removeVietnameseTones(name).replace(/[^a-z0-9_]/g, "");
  if (cleaned.length < 3) return (cleaned + "user").slice(0, 40);
  return cleaned.slice(0, 40);
}

// ----- Đoán giới tính từ tên Facebook -----
// Facebook chỉ trả giới tính khi có quyền user_gender (phải qua duyệt), nên đoán theo tên đệm tiếng Việt.
// Tên đệm kiểu nam (và không có "Thị") -> nam, còn lại mặc định nữ.
const MALE_MIDDLE_NAMES = new Set(["van", "duc", "huu", "cong", "dinh", "quang", "manh", "tien"]);

function guessGenderFromName(name) {
  // Bỏ họ (từ đầu) và tên (từ cuối), chỉ xét tên đệm
  const middle = removeVietnameseTones(name).split(/\s+/).slice(1, -1);
  const isMale = !middle.includes("thi") && middle.some((w) => MALE_MIDDLE_NAMES.has(w));
  return isMale ? "MALE" : "FEMALE";
}

async function loginWithFacebook(accessToken) {
  if (!env.facebookAppId || !env.facebookAppSecret) {
    throw new AppError("Chưa cấu hình đăng nhập Facebook", 503, "FACEBOOK_AUTH_NOT_CONFIGURED");
  }

  const appAccessToken = `${env.facebookAppId}|${env.facebookAppSecret}`;

  // 1. Xác minh accessToken qua debug_token
  let debugData;
  try {
    const debugUrl = `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`;
    const debugRes = await fetch(debugUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!debugRes.ok) {
      throw new Error(`debug_token status ${debugRes.status}`);
    }
    const json = await debugRes.json();
    debugData = json && json.data;
  } catch (err) {
    console.warn("[facebook-login] Lỗi xác minh debug_token:", err && err.message);
    throw AppError.unauthorized("Đăng nhập Facebook không hợp lệ", "INVALID_FACEBOOK_TOKEN");
  }

  if (
    !debugData ||
    debugData.is_valid !== true ||
    String(debugData.app_id) !== String(env.facebookAppId)
  ) {
    throw AppError.unauthorized("Đăng nhập Facebook không hợp lệ", "INVALID_FACEBOOK_TOKEN");
  }

  // 2. Lấy thông tin người dùng qua /me
  let profileData;
  try {
    const meUrl = `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;
    const meRes = await fetch(meUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!meRes.ok) {
      throw new Error(`/me status ${meRes.status}`);
    }
    profileData = await meRes.json();
  } catch (err) {
    console.warn("[facebook-login] Lỗi lấy thông tin /me:", err && err.message);
    throw AppError.unauthorized("Đăng nhập Facebook không hợp lệ", "INVALID_FACEBOOK_TOKEN");
  }

  const fbId = profileData ? String(profileData.id || "").trim() : "";
  const fbName = profileData ? String(profileData.name || "").trim() : "";

  if (!fbId || !fbName) {
    throw AppError.unauthorized("Đăng nhập Facebook không hợp lệ", "INVALID_FACEBOOK_TOKEN");
  }

  // 3. Tìm theo facebookId
  let user = await prisma.user.findUnique({
    where: { facebookId: fbId },
  });

  if (!user) {
    // Không có -> tạo tài khoản mới
    const baseUsername = generateBaseUsernameFromName(fbName);
    const fbGender = guessGenderFromName(fbName);
    let created = false;

    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = attempt === 0
        ? baseUsername
        : `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

      validateUsername(candidate);

      try {
        user = await prisma.user.create({
          data: {
            username: candidate,
            facebookId: fbId,
            password: null,
            email: null,
            role: "MEMBER",
            tokenVersion: 0,
            avatarUrl: null,
            gender: fbGender,
          },
        });
        created = true;
        break;
      } catch (err) {
        if (err && err.code === "P2002") {
          const target = Array.isArray(err.meta?.target)
            ? err.meta.target.join(",")
            : String(err.meta?.target || "");

          if (target.includes("facebookId")) {
            user = await prisma.user.findUnique({ where: { facebookId: fbId } });
            if (user) {
              created = true;
              break;
            }
          }
          // Trùng username -> tiếp tục thử với số ngẫu nhiên
          continue;
        }
        throw err;
      }
    }

    if (!created) {
      throw AppError.conflict("Không thể tạo tên tài khoản tự động, vui lòng thử lại sau");
    }
  }

  // Duy trì chuỗi đăng nhập cho user và cho nhóm
  const streakInfo = await recordUserLoginAndStreak(user.id);

  const { password: hashedPassword, googleId: _gid, facebookId: _fid, tokenVersion, ...safeUser } = user;
  if (streakInfo) {
    safeUser.streak = streakInfo.streak;
    safeUser.lastLoginDate = streakInfo.lastLoginDate;
  }
  const payload = buildTokenPayload(user);

  return {
    user: safeUser,
    token: signToken(payload), // 3h
    refreshToken: signRefreshToken(payload), // 7d
  };
}

module.exports = { register, login, getMe, refreshToken, loginWithGoogle, loginWithFacebook };
