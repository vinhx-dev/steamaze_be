-- Khoá bài học / đồ vật ở trạng thái "Sắp ra mắt"
ALTER TABLE "lessons" ADD COLUMN "comingSoon" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "shop_items" ADD COLUMN "comingSoon" BOOLEAN NOT NULL DEFAULT false;
