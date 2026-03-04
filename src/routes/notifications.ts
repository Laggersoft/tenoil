import { Hono } from 'hono'

type Bindings = { DB: D1Database }

async function getAuthUser(db: D1Database, authHeader: string | undefined) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const session = await db.prepare(
    'SELECT s.expires_at, u.id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?'
  ).bind(token).first<{ expires_at: string; id: number; role: string }>()
  if (!session || new Date(session.expires_at) < new Date()) return null
  return session
}

const app = new Hono<{ Bindings: Bindings }>()

// Get notifications for current user
app.get('/', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const notifications = await c.env.DB.prepare(`
    SELECT n.*, r.product_name, r.model, r.status as request_status
    FROM notifications n
    LEFT JOIN requests r ON n.request_id = r.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 50
  `).bind(user.id).all()

  return c.json({ notifications: notifications.results })
})

// Get unread count
app.get('/unread-count', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const result = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
  ).bind(user.id).first<{ count: number }>()

  return c.json({ count: result?.count || 0 })
})

// Mark as read
app.patch('/:id/read', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const id = c.req.param('id')
  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run()

  return c.json({ message: 'Уведомление прочитано' })
})

// Mark all as read
app.patch('/read-all', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  await c.env.DB.prepare(
    'UPDATE notifications SET is_read = 1 WHERE user_id = ?'
  ).bind(user.id).run()

  return c.json({ message: 'Все уведомления прочитаны' })
})

export default app
