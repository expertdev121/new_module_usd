import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://levhatora_final_owner:npg_FmBlvp78SNqZ@ep-tiny-fog-a9fqoj3f-pooler.gwc.azure.neon.tech/levhatora_final?sslmode=require&channel_binding=require'

}

const sql = neon(process.env.DATABASE_URL);
export const db = drizzle(sql, {
  schema,
  logger: process.env.NODE_ENV === "development" ? true : false,
});
