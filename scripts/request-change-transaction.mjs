export function reviewRequestChangeInTransaction({ db, changeId, decision, suggestAllocation, audit = () => {} }) {
  let token = "";
  const transaction = db.transaction(() => {
    const change = db.prepare(`SELECT c.id,c.request_id,c.guest_name,c.starts_on,c.ends_on,c.party_size,c.accepts_sofa,
      c.accepts_air_mattress,c.exclusive,c.note,q.status request_status,q.stay_id,q.manage_token,
      s.starts_on stay_starts_on,s.ends_on stay_ends_on
      FROM request_changes c JOIN requests q ON q.id=c.request_id JOIN stays s ON s.id=q.stay_id
      WHERE c.id=? AND c.status='pending'`).get(changeId);
    if (!change) {
      const reviewed = db.prepare(`SELECT c.status,q.manage_token FROM request_changes c
        JOIN requests q ON q.id=c.request_id WHERE c.id=?`).get(changeId);
      if (reviewed && reviewed.status === (decision === "approve" ? "approved" : "rejected")) {
        token = reviewed.manage_token;
        return;
      }
      throw new Error("form");
    }
    token = change.manage_token;
    if (decision === "reject") {
      db.prepare("UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(change.id);
      audit("request_change.rejected", "request_change", change.id);
      return;
    }
    if (change.request_status !== "approved") throw new Error("form");
    if ((change.stay_starts_on && change.starts_on < change.stay_starts_on) ||
        (change.stay_ends_on && change.ends_on > change.stay_ends_on)) throw new Error("dates");
    if (db.prepare("SELECT 1 FROM blackouts WHERE stay_id=? AND starts_on < ? AND ends_on > ? LIMIT 1")
      .get(change.stay_id, change.ends_on, change.starts_on)) throw new Error("blocked");
    db.prepare("DELETE FROM allocations WHERE request_id=?").run(change.request_id);
    db.prepare(`UPDATE requests SET guest_name=?,starts_on=?,ends_on=?,party_size=?,accepts_sofa=?,
      accepts_air_mattress=?,exclusive=?,note=? WHERE id=?`).run(
        change.guest_name, change.starts_on, change.ends_on, change.party_size, change.accepts_sofa,
        change.accepts_air_mattress, change.exclusive, change.note, change.request_id,
      );
    if (!suggestAllocation(change.request_id)) throw new Error("capacity");
    db.prepare("UPDATE request_changes SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=?").run(change.id);
    audit("request_change.approved", "request_change", change.id);
  });
  transaction.immediate();
  return token;
}
