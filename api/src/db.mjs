import pg from "pg";
import { promises as fs } from "node:fs";
import path from "node:path";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE || 10),
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined
});

export async function initDb() {
  const sqlPath = path.resolve(new URL("../sql/001_init.sql", import.meta.url).pathname);
  const sql = await fs.readFile(sqlPath, "utf8");
  await pool.query(sql);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
