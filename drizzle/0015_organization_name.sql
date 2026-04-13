CREATE TABLE "organization_name" (
  "id" serial PRIMARY KEY NOT NULL,
  "location_id" text NOT NULL,
  "org_name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "organization_name_location_id_unique" ON "organization_name" USING btree ("location_id");
