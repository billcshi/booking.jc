export function cancelTrackedRequestInTransaction({ db, token }) {
  const transaction = db.transaction(() => {
    const request = db.prepare("SELECT id FROM requests WHERE manage_token=? AND deleted_at IS NULL").get(token);
    if (!request) throw new Error("status");
    db.prepare("UPDATE request_changes SET status='rejected',reviewed_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='pending'").run(request.id);
    db.prepare("UPDATE requests SET status='cancelled' WHERE id=?").run(request.id);
    db.prepare("DELETE FROM allocations WHERE request_id=?").run(request.id);
  });
  transaction.immediate();
}
