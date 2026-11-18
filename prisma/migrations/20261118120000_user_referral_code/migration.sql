-- Sinh mã giới thiệu 8 ký tự, bỏ các ký tự dễ nhầm (0, O, 1, I)
CREATE FUNCTION generate_referral_code() RETURNS VARCHAR(8) AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate TEXT;
BEGIN
  LOOP
    SELECT string_agg(substr(alphabet, 1 + floor(random() * 32)::INT, 1), '')
      INTO candidate
      FROM generate_series(1, 8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM "users" WHERE "referralCode" = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referralCode" VARCHAR(8),
ADD COLUMN     "referralRedeemedAt" TIMESTAMP(3),
ADD COLUMN     "referredById" TEXT;

-- Cấp mã cho các tài khoản đã có
UPDATE "users" SET "referralCode" = generate_referral_code();

ALTER TABLE "users" ALTER COLUMN "referralCode" SET NOT NULL,
ALTER COLUMN "referralCode" SET DEFAULT generate_referral_code();

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE INDEX "users_referredById_idx" ON "users"("referredById");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
