// Các trường được phép trả ra ngoài - tuyệt đối không có password hay googleId
const USER_PUBLIC_SELECT = {
  id: true,
  username: true,
  email: true,
  avatarUrl: true,
  inventoryAvatarUrl: true,
  role: true,
  gender: true,
  coins: true,
  streak: true,
  lastLoginDate: true,
  createdAt: true,
  updatedAt: true,
};


// Thêm số ảnh trong nhật kí cho danh sách user
const USER_WITH_IMAGE_COUNT_SELECT = {
  ...USER_PUBLIC_SELECT,
  _count: { select: { journalImages: true } },
};

const JOURNAL_IMAGE_SELECT = {
  id: true,
  imageUrl: true,
  capturedAt: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
};

// Nhóm kèm danh sách thành viên, dùng cho trang bạn bè
const GROUP_SELECT = {
  id: true,
  name: true,
  ownerId: true,
  streak: true,
  lastStreakDate: true,
  createdAt: true,
  updatedAt: true,
  members: {
    select: {
      id: true,
      role: true,
      joinedAt: true,
      user: { select: USER_PUBLIC_SELECT },
    },
    orderBy: { joinedAt: "asc" },
  },
};

const GROUP_BASIC_SELECT = {
  id: true,
  name: true,
  ownerId: true,
  streak: true,
  lastStreakDate: true,
  createdAt: true,
  updatedAt: true,
};

// Lời mời kèm thông tin nhóm và người gửi để hiển thị "ai đã mời bạn"
const INVITATION_SELECT = {
  id: true,
  groupId: true,
  inviterId: true,
  inviteeId: true,
  status: true,
  createdAt: true,
  respondedAt: true,
  group: { select: GROUP_BASIC_SELECT },
  inviter: { select: USER_PUBLIC_SELECT },
};

// Phòng kèm số bài học, dùng cho trang danh sách phòng
const ROOM_SELECT = {
  id: true,
  name: true,
  imageUrl: true,
  order: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { lessons: true } },
};

// Phòng gọn, dùng làm quan hệ lồng trong bài học
// Thông tin phòng gửi kèm chi tiết bài học. KHÔNG kèm ảnh phòng: ảnh lưu dạng Base64
// nặng ~1MB mà trang chơi bài không dùng tới (trước đây mỗi lần mở bài tải thừa ~1,1MB)
const ROOM_BASIC_SELECT = {
  id: true,
  name: true,
  order: true,
  createdAt: true,
  updatedAt: true,
};

// Danh sách bài học không kèm html để nhẹ payload
const LESSON_SELECT = {
  id: true,
  roomId: true,
  name: true,
  imageUrl: true,
  order: true,
  slug: true,
  path: true,
  requiredSlots: true,
  published: true,
  comingSoon: true,
  createdAt: true,
  updatedAt: true,
};

// Chi tiết bài học: có thêm mã html thuần để chạy trong iframe
const LESSON_DETAIL_SELECT = {
  ...LESSON_SELECT,
  html: true,
  room: { select: ROOM_BASIC_SELECT },
};

// Danh sách bài báo hiển thị ngoài trang tin tức
const ARTICLE_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImage: true,
  category: true,
  author: true,
  authorRole: true,
  publishedAt: true,
  readTime: true,
  featured: true,
  hot: true,
  tier: true,
  tags: true,
  views: true,
  createdAt: true,
  updatedAt: true,
};

// Chi tiết bài báo kèm nội dung toàn văn
const ARTICLE_DETAIL_SELECT = {
  ...ARTICLE_SELECT,
  content: true,
  createdById: true,
};

module.exports = {
  USER_PUBLIC_SELECT,
  USER_WITH_IMAGE_COUNT_SELECT,
  JOURNAL_IMAGE_SELECT,
  GROUP_SELECT,
  GROUP_BASIC_SELECT,
  INVITATION_SELECT,
  ROOM_SELECT,
  ROOM_BASIC_SELECT,
  LESSON_SELECT,
  LESSON_DETAIL_SELECT,
  ARTICLE_SELECT,
  ARTICLE_DETAIL_SELECT,
};

