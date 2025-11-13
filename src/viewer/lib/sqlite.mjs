import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_DB_NAME = "arena-viewer.sqlite";

/**
 * @typedef {Object} VoteRecord
 * @property {string} [id]
 * @property {string} pairId
 * @property {string} leftVariantId
 * @property {string} rightVariantId
 * @property {string | null} winnerVariantId
 * @property {"left" | "right" | "tie" | "both_bad"} selection
 * @property {Record<string, number | null> | undefined} [scores]
 * @property {string | null | undefined} [notes]
 * @property {Record<string, unknown> | null | undefined} [automationMetadata]
 */

/**
 * @typedef {Object} SqliteContext
 * @property {import("better-sqlite3").Database} db
 * @property {string} dbPath
 */

/**
 * @param {string} rootDir
 * @param {string} [dbFileName]
 * @returns {SqliteContext}
 */
export function initDatabase(rootDir, dbFileName = DEFAULT_DB_NAME) {
  const dataDir = path.resolve(rootDir, "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, dbFileName);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      pair_id TEXT NOT NULL,
      left_variant_id TEXT NOT NULL,
      right_variant_id TEXT NOT NULL,
      winner_variant_id TEXT,
      selection TEXT NOT NULL,
      scores_json TEXT,
      notes TEXT,
      automation_metadata_json TEXT
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS votes_pair_id_idx ON votes(pair_id);
  `);

  return { db, dbPath };
}

/**
 * @param {SqliteContext} ctx
 * @param {VoteRecord} vote
 * @returns {VoteRecord}
 */
export function recordVote(ctx, vote) {
  const id = vote.id ?? crypto.randomUUID();
  const insert = ctx.db.prepare(`
    INSERT INTO votes (
      id,
      pair_id,
      left_variant_id,
      right_variant_id,
      winner_variant_id,
      selection,
      scores_json,
      notes,
      automation_metadata_json
    ) VALUES (
      @id,
      @pairId,
      @leftVariantId,
      @rightVariantId,
      @winnerVariantId,
      @selection,
      @scoresJson,
      @notes,
      @automationMetadataJson
    )
  `);

  insert.run({
    id,
    pairId: vote.pairId,
    leftVariantId: vote.leftVariantId,
    rightVariantId: vote.rightVariantId,
    winnerVariantId: vote.winnerVariantId,
    selection: vote.selection,
    scoresJson: vote.scores ? JSON.stringify(vote.scores) : null,
    notes: vote.notes ?? null,
    automationMetadataJson: vote.automationMetadata ? JSON.stringify(vote.automationMetadata) : null,
  });

  return { ...vote, id };
}

/**
 * @param {SqliteContext} ctx
 * @param {number} [limit]
 * @returns {VoteRecord[]}
 */
export function listRecentVotes(ctx, limit = 50) {
  const query = ctx.db.prepare(`
    SELECT
      id,
      pair_id AS pairId,
      left_variant_id AS leftVariantId,
      right_variant_id AS rightVariantId,
      winner_variant_id AS winnerVariantId,
      selection,
      scores_json AS scoresJson,
      notes,
      automation_metadata_json AS automationMetadataJson
    FROM votes
    ORDER BY created_at DESC
    LIMIT @limit
  `);

  return query.all({ limit }).map((row) => ({
    id: row.id,
    pairId: row.pairId,
    leftVariantId: row.leftVariantId,
    rightVariantId: row.rightVariantId,
    winnerVariantId: row.winnerVariantId,
    selection: row.selection,
    scores: row.scoresJson ? JSON.parse(row.scoresJson) : undefined,
    notes: row.notes ?? undefined,
    automationMetadata: row.automationMetadataJson ? JSON.parse(row.automationMetadataJson) : undefined,
  }));
}

export function listLeaderboard(ctx, limit = 10) {
  const query = ctx.db.prepare(`
    SELECT
      winner_variant_id AS variantId,
      COUNT(*) AS wins
    FROM votes
    WHERE winner_variant_id IS NOT NULL AND winner_variant_id != ''
    GROUP BY winner_variant_id
    ORDER BY wins DESC
    LIMIT @limit
  `);

  return query.all({ limit }).map((row) => ({
    variantId: row.variantId,
    wins: Number(row.wins),
  }));
}

export function getVoteStats(ctx) {
  const totals = ctx.db.prepare(`
    SELECT
      COUNT(*) AS totalVotes,
      MAX(created_at) AS lastUpdated
    FROM votes
  `).get();

  const distinct = ctx.db.prepare(`
    SELECT COUNT(DISTINCT winner_variant_id) AS totalModels
    FROM votes
    WHERE winner_variant_id IS NOT NULL AND winner_variant_id != ''
  `).get();

  return {
    totalVotes: Number(totals?.totalVotes ?? 0),
    lastUpdated: totals?.lastUpdated ?? null,
    totalModels: Number(distinct?.totalModels ?? 0),
  };
}

export function listBattleHistory(ctx, limit = 50) {
  const query = ctx.db.prepare(`
    SELECT
      id,
      created_at AS createdAt,
      left_variant_id AS leftVariantId,
      right_variant_id AS rightVariantId,
      winner_variant_id AS winnerVariantId,
      selection,
      notes
    FROM votes
    WHERE selection IN ('left', 'right', 'tie', 'both_bad')
      AND (notes IS NULL OR notes != 'demo-leaderboard')
  ORDER BY created_at DESC
  LIMIT @limit
  `);

  return query.all({ limit }).map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    leftVariantId: row.leftVariantId,
    rightVariantId: row.rightVariantId,
    winnerVariantId: row.winnerVariantId,
    selection: row.selection,
    notes: row.notes ?? null,
  }));
}

/**
 * @param {SqliteContext} ctx
 */
export function closeDatabase(ctx) {
  ctx.db.close();
}
