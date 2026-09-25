import { randomBytes } from "node:crypto";
import { getD1Client, type D1Client } from "../packages/web/src/lib/d1";

const invalidCode = "(length(invite_code) != 32 OR invite_code GLOB '*[^0-9a-f]*')";

export async function rotateTeamInvites(db: Pick<D1Client, "query" | "batch">, apply = false) {
  const { results } = await db.query<{ id: string }>(`SELECT id FROM teams WHERE ${invalidCode}`);
  if (!apply) return { pending: results.length, rotated: 0 };
  let rotated = 0;
  for (let offset = 0; offset < results.length; offset += 100) {
    const writes = await db.batch(results.slice(offset, offset + 100).map(({ id }) => ({
      sql: `UPDATE teams SET invite_code = ? WHERE id = ? AND ${invalidCode}`,
      params: [randomBytes(16).toString("hex"), id],
    })));
    rotated += writes.reduce((count, result) => count + result.meta.changes, 0);
  }
  return { pending: results.length - rotated, rotated };
}

if (import.meta.main) {
  console.log(JSON.stringify(await rotateTeamInvites(getD1Client(), process.argv.includes("--apply"))));
}
