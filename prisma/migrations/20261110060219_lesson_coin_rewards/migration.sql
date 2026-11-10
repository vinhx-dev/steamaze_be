-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "firstPlayCoins" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "replayCoins" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "user_lesson_rewards" ADD COLUMN     "completionCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "lastCompletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "totalCoins" INTEGER NOT NULL DEFAULT 0;

-- Cập nhật dữ liệu cũ: đặt totalCoins = coins cho các bản ghi đã có
UPDATE "user_lesson_rewards" SET "totalCoins" = "coins";
