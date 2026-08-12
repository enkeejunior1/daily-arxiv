import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const dailyArxivState = sqliteTable("daily_arxiv_state", {
  userId: text("user_id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});
