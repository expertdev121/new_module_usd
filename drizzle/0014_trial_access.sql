CREATE TYPE "public"."user_access_type" AS ENUM('full', 'trial');
ALTER TABLE "user" ADD COLUMN "access_type" "user_access_type" DEFAULT 'full' NOT NULL;
