import db from '../src/db/index.js'
const { c: before } = db.prepare("SELECT COUNT(*) as c FROM tracks WHERE download_status = 'pending'").get() as { c: number }
console.log(`Deleting ${before} pending tracks...`)
db.prepare("DELETE FROM playlist_tracks WHERE track_id IN (SELECT id FROM tracks WHERE download_status = 'pending')").run()
db.prepare("DELETE FROM tracks WHERE download_status = 'pending'").run()
const { c: after } = db.prepare("SELECT COUNT(*) as c FROM tracks WHERE download_status = 'pending'").get() as { c: number }
console.log(`Done. Pending: ${before} → ${after}`)
const stats = db.prepare("SELECT download_status, COUNT(*) as cnt FROM tracks GROUP BY download_status").all()
console.log('Remaining:', stats)
