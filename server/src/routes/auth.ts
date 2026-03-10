import { Router } from 'express'
import crypto from 'crypto'
import { createUser, getUserByUsername, getUserById, getAllUsers, createSession, getSession, deleteSession } from '../db/index.js'

const router = Router()

function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  const derived = crypto.scryptSync(pin, salt, 64).toString('hex')
  return derived === hash
}

// List all users (for login picker)
router.get('/users', (_req, res) => {
  res.json({ users: getAllUsers() })
})

// Register new user
router.post('/register', (req, res) => {
  const { username, displayName, pin } = req.body as { username: string; displayName: string; pin: string }
  if (!username || !displayName || !pin) {
    res.status(400).json({ error: 'username, displayName, and pin are required' })
    return
  }
  if (pin.length < 4) {
    res.status(400).json({ error: 'PIN must be at least 4 characters' })
    return
  }
  if (getUserByUsername(username)) {
    res.status(409).json({ error: 'Username already taken' })
    return
  }

  const pinHash = hashPin(pin)
  const id = createUser(username, displayName, pinHash)
  const token = crypto.randomUUID()
  createSession(id, token)

  res.json({
    token,
    user: { id, username, displayName },
  })
})

// Login
router.post('/login', (req, res) => {
  const { username, pin } = req.body as { username: string; pin: string }
  if (!username || !pin) {
    res.status(400).json({ error: 'username and pin are required' })
    return
  }

  const user = getUserByUsername(username)
  if (!user || !verifyPin(pin, user.pin_hash)) {
    res.status(401).json({ error: 'Invalid username or PIN' })
    return
  }

  const token = crypto.randomUUID()
  createSession(user.id, token)

  res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.display_name },
  })
})

// Get current user from session
router.get('/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  const session = getSession(token)
  if (!session) {
    res.status(401).json({ error: 'Session expired' })
    return
  }

  const user = getUserById(session.user_id)
  if (!user) {
    res.status(401).json({ error: 'User not found' })
    return
  }

  res.json({
    user: { id: user.id, username: user.username, displayName: user.display_name },
  })
})

// Logout
router.post('/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) deleteSession(token)
  res.json({ success: true })
})

export default router
