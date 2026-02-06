import postgres from "postgres";
import * as schema from "@/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/utils/env";
import { logger } from "@/utils/logger";

let client: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

console.log("Schema keys:", Object.keys(schema));

export const getDb = () => {
  if (!client || !db) {
    logger.info("Initializing Postgres connection...");

    client = postgres(env.DATABASE_URL, {
      max: 10, // connection pool size
      idle_timeout: 20,
      connect_timeout: 10,
    });

    db = drizzle(client, { schema });
  }

  return db;
};

export const closeDb = async () => {
  if (client) {
    logger.info("Closing Postgres connection...");
    await client.end();
    client = null;
    db = null;
  }
};
