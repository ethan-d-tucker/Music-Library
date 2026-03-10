import type { Request, Response, NextFunction } from 'express'
import { getSession, getUserById } from '../db/index.js'

export interface AuthUser {
  id: number
  username: string
  displayName: string
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
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

  req.user = { id: user.id, username: user.username, displayName: user.display_name }
  next()
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (token) {
    const session = getSession(token)
    if (session) {
      const user = getUserById(session.user_id)
      if (user) {
        req.user = { id: user.id, username: user.username, displayName: user.display_name }
      }
    }
  }
  next()
}
