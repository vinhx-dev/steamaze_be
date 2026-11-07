const fs = require("fs");
const path = require("path");
const { prisma } = require("../config/db");
const { env } = require("../config/env");
const { AppError } = require("../utils/AppError");
const { extractItemSlug } = require("./inventory.service");
const { validateImageUrl } = require("../utils/validators");

// Ảnh sản phẩm: đồ trong /items/..., link http(s) hoặc ảnh Base64 tải từ máy
function validateItemImage(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.trim()) {
    throw AppError.badRequest("Ảnh sản phẩm không được để trống", { field: "imageUrl" });
  }
  return validateImageUrl(imageUrl, "imageUrl", { allowDataImage: true });
}

/**
 * Tự động đồng bộ item vào catalog.json nếu là đồ trang bị và chưa có
 */
function syncCatalogItem(slug, name, filename) {
  try {
    const catalogPath = env.labCatalogPath;
    if (!fs.existsSync(catalogPath)) return;
    const raw = fs.readFileSync(catalogPath, "utf8");
    const data = JSON.parse(raw);

    const ext = filename ? path.extname(filename).replace(".", "") : "webp";

    if (!data[slug]) {
      data[slug] = {
        name: name || slug,
        unlockedBy: "",
        ...(ext && ext !== "webp" ? { ext } : {}),
      };
      fs.writeFileSync(catalogPath, JSON.stringify(data, null, 2), "utf8");
    } else if (name && data[slug].name !== name) {
      data[slug].name = name;
      fs.writeFileSync(catalogPath, JSON.stringify(data, null, 2), "utf8");
    }
  } catch (err) {
    console.error("Lỗi đồng bộ catalog.json:", err.message);
  }
}

/**
 * Quét danh sách file ảnh có sẵn trong thư mục public/items
 */
function getAvailableAssets() {
  const itemsDir = path.dirname(env.labCatalogPath);
  if (!fs.existsSync(itemsDir)) {
    return [];
  }

  let catalog = {};
  try {
    if (fs.existsSync(env.labCatalogPath)) {
      catalog = JSON.parse(fs.readFileSync(env.labCatalogPath, "utf8"));
    }
  } catch {
    catalog = {};
  }

  const files = fs.readdirSync(itemsDir);
  const imageExts = new Set([".png", ".webp", ".jpg", ".jpeg", ".svg"]);

  const assets = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!imageExts.has(ext)) continue;

    const baseName = path.basename(file, ext);
    const slug = baseName;
    const catalogMeta = catalog[slug];

    let suggestedName = catalogMeta?.name;
    if (!suggestedName) {
      const parts = slug.split("_");
      const prefix = parts[0];
      const rest = parts.slice(1).join(" ");
      const prefixMap = {
        hat: "Mũ",
        glasses: "Kính",
        mask: "Mặt nạ",
        shirt: "Áo",
      };
      suggestedName = prefixMap[prefix]
        ? `${prefixMap[prefix]} ${rest || ""}`.trim()
        : slug.replace(/_/g, " ");
    }

    assets.push({
      filename: file,
      url: `/items/${file}`,
      slug,
      name: suggestedName,
    });
  }

  return assets;
}

/**
 * Lấy danh sách sản phẩm trong Cửa hàng
 * @param {Object} options
 * @param {boolean} [options.includeInactive=false]
 * @param {string} [options.search=""]
 * @param {string|null} [options.userId=null]
 */
async function getItems({ includeInactive = false, search = "", userId = null } = {}) {
  const where = {};
  if (!includeInactive) {
    where.isActive = true;
  }
  if (search && search.trim()) {
    where.name = { contains: search.trim(), mode: "insensitive" };
  }

  const items = await prisma.shopItem.findMany({
    where,
    orderBy: [
      { isSpecial: "desc" },
      { createdAt: "desc" },
    ],
  });

  if (!userId) {
    return items.map((item) => ({ ...item, isOwned: false }));
  }

  // Lấy các đơn hàng người dùng đã mua
  const orders = await prisma.shopOrder.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
    },
    select: { itemId: true },
  });
  const boughtItemIds = new Set(orders.map((o) => o.itemId));

  // Lấy các trang bị người dùng đã sở hữu trong tủ đồ
  const userItems = await prisma.userItem.findMany({
    where: { userId },
    select: { itemId: true },
  });
  const ownedSlugs = new Set(userItems.map((ui) => ui.itemId));

  return items.map((item) => {
    const slug = extractItemSlug(item.imageUrl);
    const isOwned = boughtItemIds.has(item.id) || (Boolean(slug) && ownedSlugs.has(slug));
    return {
      ...item,
      isOwned,
    };
  });
}

/**
 * Lấy chi tiết một sản phẩm
 */
async function getItemById(id, userId = null) {
  const item = await prisma.shopItem.findUnique({
    where: { id },
  });
  if (!item) {
    throw AppError.notFound("Không tìm thấy sản phẩm");
  }

  let isOwned = false;
  if (userId) {
    const existingOrder = await prisma.shopOrder.findFirst({
      where: {
        userId,
        itemId: id,
        status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
      },
    });
    const slug = extractItemSlug(item.imageUrl);
    let inInventory = false;
    if (slug) {
      const ownedItem = await prisma.userItem.findUnique({
        where: { userId_itemId: { userId, itemId: slug } },
      });
      inInventory = Boolean(ownedItem);
    }
    isOwned = Boolean(existingOrder) || inInventory;
  }

  return { ...item, isOwned };
}

/**
 * Admin: Tạo sản phẩm mới
 */
async function createItem({ name, description, imageUrl, coinPrice, isSpecial, stock, comingSoon }) {
  if (typeof name !== "string" || !name.trim()) {
    throw AppError.badRequest("Tên sản phẩm không được để trống", { field: "name" });
  }
  if (name.trim().length > 120) {
    throw AppError.badRequest("Tên sản phẩm tối đa 120 ký tự", { field: "name" });
  }
  imageUrl = validateItemImage(imageUrl);

  const parsedPrice = Number(coinPrice);
  if (isNaN(parsedPrice) || parsedPrice < 0 || !Number.isInteger(parsedPrice)) {
    throw AppError.badRequest("Giá xu phải là số nguyên không âm", { field: "coinPrice" });
  }

  let parsedStock = null;
  if (stock !== undefined && stock !== null && stock !== "") {
    parsedStock = Number(stock);
    if (isNaN(parsedStock) || parsedStock < 0 || !Number.isInteger(parsedStock)) {
      throw AppError.badRequest("Số lượng tồn kho phải là số nguyên không âm", { field: "stock" });
    }
  }

  const created = await prisma.shopItem.create({
    data: {
      name: name.trim(),
      description: description ? description.trim() : null,
      imageUrl,
      coinPrice: parsedPrice,
      isSpecial: Boolean(isSpecial),
      stock: parsedStock,
      isActive: true,
      comingSoon: Boolean(comingSoon),
    },
  });

  // Tự động đồng bộ catalog.json nếu là đồ trang bị trong public/items
  const slug = extractItemSlug(imageUrl);
  if (slug) {
    const filename = path.basename(imageUrl);
    syncCatalogItem(slug, name.trim(), filename);
  }

  return created;
}

/**
 * Admin: Cập nhật sản phẩm
 */
async function updateItem(id, data) {
  await getItemById(id);

  const updateData = {};
  if (data.name !== undefined) {
    if (typeof data.name !== "string" || !data.name.trim()) {
      throw AppError.badRequest("Tên sản phẩm không được để trống", { field: "name" });
    }
    if (data.name.trim().length > 120) {
      throw AppError.badRequest("Tên sản phẩm tối đa 120 ký tự", { field: "name" });
    }
    updateData.name = data.name.trim();
  }
  if (data.description !== undefined) {
    updateData.description = data.description ? data.description.trim() : null;
  }
  if (data.imageUrl !== undefined) {
    updateData.imageUrl = validateItemImage(data.imageUrl);
  }
  if (data.coinPrice !== undefined) {
    const parsedPrice = Number(data.coinPrice);
    if (isNaN(parsedPrice) || parsedPrice < 0 || !Number.isInteger(parsedPrice)) {
      throw AppError.badRequest("Giá xu phải là số nguyên không âm", { field: "coinPrice" });
    }
    updateData.coinPrice = parsedPrice;
  }
  if (data.isSpecial !== undefined) {
    updateData.isSpecial = Boolean(data.isSpecial);
  }
  if (data.isActive !== undefined) {
    updateData.isActive = Boolean(data.isActive);
  }
  if (data.comingSoon !== undefined) {
    updateData.comingSoon = Boolean(data.comingSoon);
  }
  if (data.stock !== undefined) {
    if (data.stock === null || data.stock === "") {
      updateData.stock = null;
    } else {
      const parsedStock = Number(data.stock);
      if (isNaN(parsedStock) || parsedStock < 0 || !Number.isInteger(parsedStock)) {
        throw AppError.badRequest("Số lượng tồn kho phải là số nguyên không âm", { field: "stock" });
      }
      updateData.stock = parsedStock;
    }
  }

  const updated = await prisma.shopItem.update({
    where: { id },
    data: updateData,
  });

  // Tự động đồng bộ catalog.json nếu là đồ trang bị
  if (updated.imageUrl) {
    const slug = extractItemSlug(updated.imageUrl);
    if (slug) {
      const filename = path.basename(updated.imageUrl);
      syncCatalogItem(slug, updated.name, filename);
    }
  }

  return updated;
}

/**
 * Admin: Xoá sản phẩm.
 * Xoá sản phẩm sẽ xoá theo toàn bộ đơn hàng (onDelete: Cascade), kể cả đơn
 * người dùng đã trả xu, nên chỉ cho xoá khi chưa có đơn nào. Sản phẩm đã có
 * đơn thì admin dùng "Tạm ngưng bán" (isActive = false).
 */
async function deleteItem(id) {
  await getItemById(id);
  const orderCount = await prisma.shopOrder.count({ where: { itemId: id } });
  if (orderCount > 0) {
    throw AppError.conflict(
      `Sản phẩm đã có ${orderCount} đơn hàng nên không thể xoá. Hãy chuyển sang "Tạm ngưng bán" để ẩn khỏi cửa hàng.`
    );
  }
  return await prisma.shopItem.delete({
    where: { id },
  });
}

/**
 * Người dùng mua sản phẩm bằng xu
 * - Kiểm tra đã sở hữu chưa (mua rồi không cho mua lại)
 * - Kiểm tra thông tin liên lạc nếu là đồ đặc biệt
 * - Giảm tồn kho atomic bằng updateMany (stock > 0)
 * - Trừ xu người dùng atomic bằng updateMany (coins >= price)
 * - Lưu đơn hàng (bảo vệ bởi partial unique index ở DB chống race condition)
 * - Tự động cấp vào Tủ đồ (userItem) nếu là trang bị thường
 */
async function purchaseItem({ userId, itemId, contactInfo, note }) {
  if (!itemId) {
    throw AppError.badRequest("Thiếu ID sản phẩm cần mua", { field: "itemId" });
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Tìm sản phẩm
    const item = await tx.shopItem.findUnique({
      where: { id: itemId },
    });
    if (!item || !item.isActive) {
      throw AppError.notFound("Vật phẩm không tồn tại hoặc đã ngừng bán.");
    }
    if (item.comingSoon) {
      throw AppError.badRequest("Vật phẩm này sắp ra mắt, chưa thể mua được.", {
        reason: "COMING_SOON",
      });
    }

    // 2. Kiểm tra đã sở hữu chưa
    // A. Kiểm tra đơn hàng cũ đang hiệu lực (PENDING, PROCESSING, COMPLETED)
    const existingOrder = await tx.shopOrder.findFirst({
      where: {
        userId,
        itemId: item.id,
        status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
      },
    });
    if (existingOrder) {
      throw AppError.badRequest("Bạn đã sở hữu vật phẩm này rồi, không thể mua lại nữa.");
    }

    // B. Kiểm tra trong Tủ đồ (nếu là trang bị)
    const slug = extractItemSlug(item.imageUrl);
    if (slug) {
      const existingUserItem = await tx.userItem.findUnique({
        where: { userId_itemId: { userId, itemId: slug } },
      });
      if (existingUserItem) {
        throw AppError.badRequest("Bạn đã sở hữu vật phẩm này trong Tủ đồ rồi, không thể mua lại nữa.");
      }
    }

    // 3. Kiểm tra thông tin liên lạc nếu là đồ đặc biệt
    const cleanContact = (contactInfo || "").trim();
    if (item.isSpecial && !cleanContact) {
      throw AppError.badRequest(
        "Vật phẩm này được đánh dấu là ĐẶC BIỆT! Vui lòng nhập thông tin liên lạc (SĐT, Zalo, Email, Facebook...) để Admin liên hệ trao thưởng.",
        { field: "contactInfo" }
      );
    }

    // 4. Giảm tồn kho atomic bằng updateMany với điều kiện stock > 0
    if (item.stock !== null && item.stock !== undefined) {
      const stockUpdate = await tx.shopItem.updateMany({
        where: {
          id: itemId,
          stock: { gt: 0 },
        },
        data: {
          stock: { decrement: 1 },
        },
      });
      if (stockUpdate.count === 0) {
        throw AppError.badRequest("Vật phẩm này hiện đã hết hàng.");
      }
    }

    // 5. Trừ xu người dùng atomic bằng updateMany với điều kiện coins >= price
    const coinUpdate = await tx.user.updateMany({
      where: {
        id: userId,
        coins: { gte: item.coinPrice },
      },
      data: {
        coins: { decrement: item.coinPrice },
      },
    });
    if (coinUpdate.count === 0) {
      throw AppError.badRequest("Bạn không đủ xu để mua vật phẩm này!");
    }

    // 6. Tạo đơn hàng (Được bảo vệ bởi partial unique index tại DB)
    let order;
    try {
      order = await tx.shopOrder.create({
        data: {
          userId,
          itemId,
          coinPrice: item.coinPrice,
          isSpecial: item.isSpecial,
          contactInfo: item.isSpecial ? cleanContact : null,
          note: item.isSpecial ? ((note || "").trim() || null) : null,
          status: item.isSpecial ? "PENDING" : "COMPLETED",
        },
        include: {
          item: true,
        },
      });
    } catch (err) {
      if (err.code === "P2002") {
        throw AppError.badRequest("Bạn đã sở hữu vật phẩm này rồi, không thể mua lại nữa.");
      }
      throw err;
    }

    // 7. Cấp vào tủ đồ cho đơn hàng thường (!item.isSpecial)
    if (!item.isSpecial && slug) {
      await tx.userItem.upsert({
        where: { userId_itemId: { userId, itemId: slug } },
        create: {
          userId,
          itemId: slug,
          equipped: false,
        },
        update: {},
      });
    }

    const updatedUser = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, coins: true },
    });

    return {
      order,
      remainingCoins: updatedUser ? updatedUser.coins : 0,
      isOwned: true,
      message: item.isSpecial
        ? `Mua thành công "${item.name}"! Thông tin liên lạc của bạn đã được gửi tới Admin để xử lý.`
        : `Mua thành công "${item.name}"! Món đồ đã được thêm vào Tủ đồ của bạn.`,
    };
  });
}

/**
 * Lịch sử đơn hàng của người dùng hiện tại
 */
async function getUserOrders(userId) {
  return await prisma.shopOrder.findMany({
    where: { userId },
    include: {
      item: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Admin: Xem toàn bộ đơn hàng
 * Kẹp limit 1–100, page >= 1, validate status
 */
async function getAdminOrders({ status, search, page = 1, limit = 20 } = {}) {
  const parsedPage = parseInt(page, 10);
  const parsedLimit = parseInt(limit, 10);
  const safePage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;
  const safeLimit = Number.isNaN(parsedLimit) || parsedLimit < 1 ? 20 : Math.min(parsedLimit, 100);

  const where = {};
  if (status && status !== "ALL") {
    const validStatuses = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"];
    if (validStatuses.includes(status.trim())) {
      where.status = status.trim();
    }
  }
  if (search && search.trim()) {
    where.OR = [
      { contactInfo: { contains: search.trim(), mode: "insensitive" } },
      { user: { username: { contains: search.trim(), mode: "insensitive" } } },
      { item: { name: { contains: search.trim(), mode: "insensitive" } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.shopOrder.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
            coins: true,
          },
        },
        item: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    }),
    prisma.shopOrder.count({ where }),
  ]);

  return {
    orders,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
}

/**
 * Admin: Cập nhật trạng thái đơn hàng (PENDING, PROCESSING, COMPLETED, CANCELLED)
 * Khi chuyển sang CANCELLED: hoàn xu, trả stock, gỡ đồ khỏi tủ (tất cả trong 1 transaction, so khớp slug chính xác).
 */
async function updateOrderStatus(orderId, status) {
  const validStatuses = ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED"];
  if (!validStatuses.includes(status)) {
    throw AppError.badRequest(`Trạng thái không hợp lệ. Phải là một trong: ${validStatuses.join(", ")}`);
  }

  return await prisma.$transaction(async (tx) => {
    const order = await tx.shopOrder.findUnique({
      where: { id: orderId },
      include: { item: true },
    });
    if (!order) {
      throw AppError.notFound("Không tìm thấy đơn hàng");
    }

    const oldStatus = order.status;
    if (oldStatus === status) {
      return order;
    }

    // Đơn đã huỷ đã được hoàn xu + trả kho, mở lại sẽ làm người dùng vừa có
    // xu vừa có đồ. Muốn mua lại thì người dùng đặt đơn mới.
    if (oldStatus === "CANCELLED") {
      throw AppError.badRequest("Đơn hàng đã huỷ (đã hoàn xu) nên không thể mở lại.");
    }

    // 1. Chuyển sang COMPLETED: nếu là item trang bị, cấp vào userItem
    if (status === "COMPLETED" && order.item?.imageUrl) {
      const slug = extractItemSlug(order.item.imageUrl);
      if (slug) {
        await tx.userItem.upsert({
          where: { userId_itemId: { userId: order.userId, itemId: slug } },
          create: {
            userId: order.userId,
            itemId: slug,
            equipped: false,
          },
          update: {},
        });
      }
    }

    // 2. Chuyển sang CANCELLED: hoàn xu, trả stock, gỡ đồ khỏi tủ nếu đơn chưa từng bị huỷ
    if (status === "CANCELLED" && oldStatus !== "CANCELLED") {
      // A. Hoàn xu lại cho người dùng
      if (order.coinPrice > 0) {
        await tx.user.update({
          where: { id: order.userId },
          data: { coins: { increment: order.coinPrice } },
        });
      }

      // B. Trả lại stock nếu sản phẩm có giới hạn tồn kho
      if (order.item && order.item.stock !== null && order.item.stock !== undefined) {
        await tx.shopItem.update({
          where: { id: order.itemId },
          data: { stock: { increment: 1 } },
        });
      }

      // C. Gỡ đồ khỏi tủ đồ nếu không còn đơn hàng COMPLETED nào khác có cùng slug chính xác
      if (order.item?.imageUrl) {
        const slug = extractItemSlug(order.item.imageUrl);
        if (slug) {
          const otherCompletedOrders = await tx.shopOrder.findMany({
            where: {
              id: { not: orderId },
              userId: order.userId,
              status: "COMPLETED",
            },
            include: { item: true },
          });

          const hasOtherCompletedWithSameSlug = otherCompletedOrders.some((o) => {
            if (!o.item?.imageUrl) return false;
            return extractItemSlug(o.item.imageUrl) === slug;
          });

          if (!hasOtherCompletedWithSameSlug) {
            await tx.userItem.deleteMany({
              where: { userId: order.userId, itemId: slug },
            });
          }
        }
      }
    }

    // 3. Cập nhật trạng thái đơn hàng
    return await tx.shopOrder.update({
      where: { id: orderId },
      data: { status },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        item: true,
      },
    });
  });
}

module.exports = {
  extractItemSlug,
  getAvailableAssets,
  getItems,
  getItemById,
  createItem,
  updateItem,
  deleteItem,
  purchaseItem,
  getUserOrders,
  getAdminOrders,
  updateOrderStatus,
};
