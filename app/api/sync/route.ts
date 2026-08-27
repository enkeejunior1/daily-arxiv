import { headers } from "next/headers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getD1 } from "../../../db";

const MAX_PAYLOAD_BYTES = 2_000_000;
const CREATE_STATE_TABLE = `
  CREATE TABLE IF NOT EXISTS daily_arxiv_state (
    user_id TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

type StoredSnapshot = {
  rules?: unknown;
  state?: {
    reviews?: unknown;
    notes?: unknown;
    progress?: unknown;
    preferences?: unknown;
  };
};

async function currentUserId() {
  const user = await getChatGPTUser();
  if (user) return user.userId;

  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "";
  if (/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(host)) {
    return "local-owner";
  }
  return null;
}

async function stateDatabase() {
  const database = getD1();
  await database.prepare(CREATE_STATE_TABLE).run();
  return database;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ connected: false, error: "Sign in required." }, { status: 401 });
  }

  try {
    const database = await stateDatabase();
    const row = await database
      .prepare("SELECT payload, updated_at FROM daily_arxiv_state WHERE user_id = ?")
      .bind(userId)
      .first<{ payload: string; updated_at: string }>();
    return Response.json({
      connected: true,
      snapshot: row ? (JSON.parse(row.payload) as StoredSnapshot) : null,
      updatedAt: row?.updated_at ?? null,
    });
  } catch (error) {
    return Response.json(
      { connected: false, error: error instanceof Error ? error.message : "Cloud sync unavailable." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ connected: false, error: "Sign in required." }, { status: 401 });
  }

  try {
    const snapshot = (await request.json()) as StoredSnapshot;
    if (!snapshot || typeof snapshot !== "object") {
      return Response.json({ connected: false, error: "Invalid snapshot." }, { status: 400 });
    }
    const payload = JSON.stringify({
      rules: snapshot.rules,
      state: {
        reviews: snapshot.state?.reviews,
        notes: snapshot.state?.notes,
        progress: snapshot.state?.progress,
        preferences: snapshot.state?.preferences,
      },
    });
    if (new TextEncoder().encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
      return Response.json({ connected: false, error: "Snapshot is too large." }, { status: 413 });
    }

    const updatedAt = new Date().toISOString();
    const database = await stateDatabase();
    await database
      .prepare(
        `INSERT INTO daily_arxiv_state (user_id, payload, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, payload, updatedAt)
      .run();
    return Response.json({ connected: true, updatedAt });
  } catch (error) {
    return Response.json(
      { connected: false, error: error instanceof Error ? error.message : "Cloud sync failed." },
      { status: 503 },
    );
  }
}
