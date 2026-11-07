const { prisma } = require("../config/db");
const { AppError } = require("../utils/AppError");
const { hashPassword, comparePassword } = require("../utils/password");
const {
  validateUsername,
  validatePassword,
  validateImageUrl,
  validateRole,
  validateGender,
} = require("../utils/validators");
const { USER_PUBLIC_SELECT, USER_WITH_IMAGE_COUNT_SELECT } = require("../utils/select");
const { invalidateUserAuthCache } = require("../middlewares/auth");

function buildWhere({ username, role }) {
  const where = {};

  if (username) {
    // mode insensitive chỉ có trên PostgreSQL
    where.username = { contains: username, mode: "insensitive" };
  }
  if (role) {
    where.role = String(role).toUpperCase();
  }

  return where;
}

// Chỉ ADMIN được xem tài khoản bất kỳ, thành viên chỉ xem được chính mình
function assertCanAccess(targetId, actor) {
  if (actor.role === "ADMIN") {
    return;
  }
  if (actor.id !== targetId) {
    throw AppError.forbidden("Không được sửa thông tin của tài khoản khác");
  }
}

async function listUsers({ page, pageSize, ...filters }) {
  const where = buildWhere(filters);

  // Gộp 2 truy vấn thành 1 round-trip
  const [total, data] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: USER_WITH_IMAGE_COUNT_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { data, total };
}

async function getUserById(id, actor) {
  assertCanAccess(id, actor);

  const user = await prisma.user.findUnique({
    where: { id },
    select: USER_PUBLIC_SELECT,
  });

  if (!user) {
    throw AppError.notFound("Không tìm thấy người dùng");
  }

  return user;
}

async function createUser({ username, password, avatarUrl, gender, role }) {
  validateUsername(username);
  validatePassword(password);
  const cleanGender = validateGender(gender);
  const cleanRole = role ? validateRole(role) : "MEMBER";

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    throw AppError.conflict("Tài khoản đã tồn tại", { field: "username" });
  }

  return prisma.user.create({
    data: {
      username,
      password: await hashPassword(password),
      avatarUrl: avatarUrl || null,
      gender: cleanGender,
      role: cleanRole,
    },
    select: USER_PUBLIC_SELECT,
  });
}

async function updateUser(id, payload, actor) {
  assertCanAccess(id, actor);
  const current = await getUserById(id, actor);

  const { username, password, currentPassword, avatarUrl, inventoryAvatarUrl, gender, role } = payload;

  // Thành viên không được tự đổi tên hoặc tự nâng quyền
  if (actor.role !== "ADMIN" && (role !== undefined || username !== undefined)) {
    throw AppError.forbidden("Chỉ quản trị viên mới đổi được tài khoản hoặc vai trò");
  }

  const data = {};

  let tokenVersionIncremented = false;
  if (username !== undefined) {
    validateUsername(username);
    data.username = username;
  }
  if (password !== undefined) {
    validatePassword(password);
    // Thành viên tự đổi mật khẩu phải nhập đúng mật khẩu cũ, tránh trường hợp ai đó
    // lấy được phiên đăng nhập rồi đổi mật khẩu để chiếm luôn tài khoản.
    // Admin đặt lại mật khẩu cho người khác (trang quản trị) thì không cần.
    if (actor.role !== "ADMIN") {
      const record = await prisma.user.findUnique({ where: { id }, select: { password: true } });
      if (!record) {
        throw AppError.notFound("Không tìm thấy người dùng");
      }
      // Nếu tài khoản đã có mật khẩu thì kiểm tra currentPassword.
      // Nếu tài khoản tạo bằng Google (password null) thì cho phép đặt mật khẩu mới không cần currentPassword.
      if (record.password) {
        if (typeof currentPassword !== "string" || !currentPassword) {
          throw AppError.badRequest("Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu", {
            field: "currentPassword",
          });
        }
        if (!(await comparePassword(currentPassword, record.password))) {
          throw AppError.badRequest("Mật khẩu hiện tại không đúng", { field: "currentPassword" });
        }
      }
    }
    data.password = await hashPassword(password);
    data.tokenVersion = { increment: 1 };
    tokenVersionIncremented = true;
  }
  if (avatarUrl !== undefined) {
    // Ảnh đại diện cắt ở trang hồ sơ được gửi lên dạng Base64, kiểm tra loại ảnh và giới hạn 500KB
    data.avatarUrl = avatarUrl
      ? validateImageUrl(avatarUrl, "avatarUrl", { allowDataImage: true })
      : null;
  }
  if (inventoryAvatarUrl !== undefined) {
    data.inventoryAvatarUrl = inventoryAvatarUrl
      ? validateImageUrl(inventoryAvatarUrl, "inventoryAvatarUrl")
      : null;
  }
  if (gender !== undefined) {
    data.gender = validateGender(gender);
  }
  // Chỉ coi là đổi vai trò khi giá trị thật sự khác, tránh thu hồi phiên vô cớ
  if (role !== undefined) {
    const nextRole = validateRole(role);
    if (nextRole !== current.role) {
      if (actor.id === id) {
        throw AppError.forbidden("Không thể tự thay đổi vai trò của chính mình");
      }
      data.role = nextRole;
      if (!tokenVersionIncremented) {
        data.tokenVersion = { increment: 1 };
      }
    }
  }

  if (Object.keys(data).length === 0) {
    throw AppError.badRequest("Không có trường nào để cập nhật");
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: USER_PUBLIC_SELECT,
  });

  invalidateUserAuthCache(id);
  return updated;
}

async function deleteUser(id, actor) {
  if (actor.id === id) {
    throw AppError.forbidden("Không thể tự xoá tài khoản đang đăng nhập");
  }
  await getUserById(id, actor);
  // Ảnh nhật kí bị xoá theo do onDelete: Cascade
  await prisma.user.delete({ where: { id } });
  invalidateUserAuthCache(id);
  return { id };
}

async function getGenderStats() {
  const [total, grouped] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({
      by: ["gender"],
      _count: { id: true },
    }),
  ]);

  let male = 0;
  let female = 0;
  let other = 0;
  let unspecified = 0;

  for (const item of grouped) {
    const count = item._count.id;
    if (item.gender === "MALE") {
      male += count;
    } else if (item.gender === "FEMALE") {
      female += count;
    } else if (item.gender === "OTHER") {
      other += count;
    } else {
      unspecified += count;
    }
  }

  return {
    total,
    male,
    female,
    other,
    unspecified,
  };
}

async function getAdminOverviewStats() {
  const [
    genderStats,
    totalArticles,
    totalLessons,
    rooms,
    specialOrdersCount,
    totalOrders,
    specialOrdersPending,
    specialOrdersCompleted,
  ] = await Promise.all([
    getGenderStats(),
    prisma.article.count(),
    prisma.lesson.count(),
    prisma.room.findMany({
      orderBy: { order: "asc" },
      select: {
        id: true,
        name: true,
        order: true,
        _count: {
          select: { lessons: true },
        },
      },
    }),
    prisma.shopOrder.count({
      where: { isSpecial: true },
    }),
    prisma.shopOrder.count(),
    prisma.shopOrder.count({
      where: { isSpecial: true, status: "PENDING" },
    }),
    prisma.shopOrder.count({
      where: { isSpecial: true, status: "COMPLETED" },
    }),
  ]);

  const lessonsByRoom = rooms.map((r) => ({
    roomId: r.id,
    roomName: r.name,
    order: r.order,
    lessonCount: r._count.lessons,
  }));

  return {
    totalUsers: genderStats.total,
    gender: genderStats,
    totalArticles,
    totalLessons,
    lessonsByRoom,
    specialOrdersCount,
    specialOrdersPending,
    specialOrdersCompleted,
    totalOrders,
  };
}

module.exports = {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getGenderStats,
  getAdminOverviewStats,
};
