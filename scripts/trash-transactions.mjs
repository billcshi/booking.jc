/** @type {(requestId: number) => void} */
const noAudit = () => {};

export function permanentlyDeleteTrashedRequestInTransaction({ db, requestId, audit = noAudit }) {
  const transaction = db.transaction(() => {
    const request = db.prepare("SELECT id FROM requests WHERE id=? AND deleted_at IS NOT NULL").get(requestId);
    if (!request) throw new Error("form");
    db.prepare("DELETE FROM requests WHERE id=? AND deleted_at IS NOT NULL").run(requestId);
    audit(requestId);
  });
  transaction.immediate();
}
