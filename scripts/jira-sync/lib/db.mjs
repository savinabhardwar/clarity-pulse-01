import pg from "pg";

const { Pool } = pg;

export function makePool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new Pool({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false } });
}

/**
 * Generic bulk upsert: builds one multi-row INSERT ... ON CONFLICT per
 * call. `rows` is an array of plain objects, all sharing the same keys.
 */
export async function upsert(pool, table, rows, { conflictColumns, updateColumns }) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const updateCols = updateColumns || columns.filter((c) => !conflictColumns.includes(c));

  const CHUNK = 500;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const values = [];
    const tuples = chunk.map((row, i) => {
      const placeholders = columns.map((_, j) => {
        values.push(row[columns[j]]);
        return `$${i * columns.length + j + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });

    const conflictAction =
      updateCols.length === 0
        ? "do nothing"
        : `do update set ${updateCols.map((c) => `${c} = excluded.${c}`).join(", ")}`;
    const sql = `
      insert into ${table} (${columns.join(", ")})
      values ${tuples.join(", ")}
      on conflict (${conflictColumns.join(", ")})
      ${conflictAction}
    `;
    await pool.query(sql, values);
  }
}

/** Plain bulk insert, no conflict handling -- for append-only history tables. */
export async function insertMany(pool, table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const CHUNK = 500;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const values = [];
    const tuples = chunk.map((row, i) => {
      const placeholders = columns.map((_, j) => {
        values.push(row[columns[j]]);
        return `$${i * columns.length + j + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await pool.query(`insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}`, values);
  }
}

export async function replaceComputed(pool, table, rows, { scopeColumn, scopeValue }) {
  await pool.query(`delete from ${table} where ${scopeColumn} = $1`, [scopeValue]);
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const CHUNK = 500;
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const values = [];
    const tuples = chunk.map((row, i) => {
      const placeholders = columns.map((_, j) => {
        values.push(row[columns[j]]);
        return `$${i * columns.length + j + 1}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await pool.query(`insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}`, values);
  }
}
