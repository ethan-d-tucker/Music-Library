declare namespace Express {
  interface Request {
    user?: {
      id: number
      username: string
      displayName: string
    }
  }
}
