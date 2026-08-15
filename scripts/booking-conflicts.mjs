/**
 * @param {import("better-sqlite3").Database} db
 * @param {{
 *   stayId: number,
 *   startsOn: string,
 *   endsOn: string,
 *   exclusive: boolean,
 *   excludeRequestId?: number | null,
 * }} booking
 * @returns {Array<{id: number, exclusive: number}> | null}
 */
export function approvedExclusiveConflict(db, {
  stayId,
  startsOn,
  endsOn,
  exclusive,
  excludeRequestId = null,
}) {
  const excludeClause = Number.isInteger(excludeRequestId) ? "AND id<>?" : "";
  const parameters = [stayId];
  if (excludeClause) parameters.push(excludeRequestId);
  parameters.push(endsOn, startsOn);

  const overlaps = db.prepare(`SELECT id,exclusive FROM requests
    WHERE deleted_at IS NULL AND stay_id=? ${excludeClause} AND status='approved'
      AND starts_on < ? AND ends_on > ? ORDER BY id`).all(...parameters);

  if ((exclusive && overlaps.length > 0) || overlaps.some((request) => request.exclusive)) {
    return overlaps;
  }
  return null;
}
