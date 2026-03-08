import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { PORT, YTDLP_PATH, FFMPEG_DIR, MUSIC_DIR } from './config.js'
import spotifyRouter from './routes/spotify.js'
import downloadRouter from './routes/download.js'
import libraryRouter from './routes/library.js'
import playlistsRouter from './routes/playlists.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.join(__dirname, '../../client/dist')

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/spotify', spotifyRouter)
app.use('/api/download', downloadRouter)
app.use('/api/library', libraryRouter)
app.use('/api/playlists', playlistsRouter)

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    musicDir: MUSIC_DIR,
    ytdlp: YTDLP_PATH,
    ffmpeg: FFMPEG_DIR || 'not found',
  })
})

// Serve client static files
app.use(express.static(clientDist))
app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`Music directory: ${MUSIC_DIR}`)
})
