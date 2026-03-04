import { Hono } from 'hono'

type Bindings = { DB: D1Database }

interface User {
  id: number
  username: string
  email: string
  role: string
  full_name: string
}

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png'
]

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
}

// Auth middleware
async function getAuthUser(db: D1Database, authHeader: string | undefined): Promise<User | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const session = await db.prepare(
    'SELECT s.expires_at, u.id, u.username, u.email, u.role, u.full_name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ?'
  ).bind(token).first<{ expires_at: string; id: number; username: string; email: string; role: string; full_name: string }>()

  if (!session || new Date(session.expires_at) < new Date()) return null

  return {
    id: session.id,
    username: session.username,
    email: session.email,
    role: session.role,
    full_name: session.full_name
  }
}

// Log audit event
async function logHistory(
  db: D1Database,
  requestId: number,
  changedBy: number,
  action: string,
  oldValue: string | null,
  newValue: string | null,
  comment: string | null = null
) {
  await db.prepare(
    'INSERT INTO request_status_history (request_id, changed_by, action, old_value, new_value, comment) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(requestId, changedBy, action, oldValue, newValue, comment).run()
}

// Generate request number: TEN-YYYY-NNNNNN
function generateRequestNumber(id: number): string {
  const year = new Date().getFullYear()
  return `TEN-${year}-${String(id).padStart(6, '0')}`
}

const app = new Hono<{ Bindings: Bindings }>()

// ============================================================
// CREATE REQUEST (applicant only)
// ============================================================
app.post('/', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (user.role !== 'applicant') return c.json({ error: 'Только заявители могут создавать заявки' }, 403)

  const { product_name, model, quantity, comment, project_id, priority } = await c.req.json()

  if (!product_name || !model || !quantity) {
    return c.json({ error: 'Наименование, модель и количество обязательны' }, 400)
  }

  if (quantity <= 0) {
    return c.json({ error: 'Количество должно быть больше 0' }, 400)
  }

  const validPriorities = ['low', 'medium', 'high', 'urgent']
  const reqPriority = validPriorities.includes(priority) ? priority : 'medium'

  const result = await c.env.DB.prepare(
    'INSERT INTO requests (applicant_id, project_id, product_name, model, quantity, comment, priority) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, project_id || null, product_name, model, quantity, comment || null, reqPriority).run()

  const requestId = result.meta.last_row_id as number

  // Generate and set request_number
  const requestNumber = generateRequestNumber(requestId)
  await c.env.DB.prepare(
    'UPDATE requests SET request_number = ? WHERE id = ?'
  ).bind(requestNumber, requestId).run()

  // Audit log: created
  await logHistory(c.env.DB, requestId, user.id, 'created', null, 'pending', `Заявка создана пользователем ${user.full_name}`)

  // Notify all suppliers
  const suppliers = await c.env.DB.prepare(
    "SELECT id FROM users WHERE role = 'supplier' AND is_blocked = 0"
  ).all<{ id: number }>()

  // Notify admins too
  const admins = await c.env.DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' AND is_blocked = 0"
  ).all<{ id: number }>()

  const allRecipients = [...(suppliers.results || []), ...(admins.results || [])]

  if (allRecipients.length) {
    const notifyStmt = c.env.DB.prepare(
      'INSERT INTO notifications (user_id, title, message, request_id) VALUES (?, ?, ?, ?)'
    )
    const batch = allRecipients.map((s) =>
      notifyStmt.bind(
        s.id,
        'Новая заявка',
        `${user.full_name} создал заявку: ${product_name} (${model}), кол-во: ${quantity}`,
        requestId
      )
    )
    await c.env.DB.batch(batch)
  }

  return c.json({ message: 'Заявка создана', id: requestId, request_number: requestNumber }, 201)
})

// ============================================================
// GET REQUESTS (with filters)
// ============================================================
app.get('/', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const status = c.req.query('status')
  const search = c.req.query('search')
  const sort = c.req.query('sort') || 'desc'
  const project_id = c.req.query('project_id')
  const applicant_id = c.req.query('applicant_id')
  const date_from = c.req.query('date_from')
  const date_to = c.req.query('date_to')
  const priority = c.req.query('priority')
  const sort_by = c.req.query('sort_by') || 'date' // 'date' | 'priority'

  let query = `
    SELECT r.*, u.full_name as applicant_name, u.username as applicant_username,
           p.name as project_name
    FROM requests r
    JOIN users u ON r.applicant_id = u.id
    LEFT JOIN projects p ON r.project_id = p.id
    WHERE 1=1
  `
  let params: (string | number)[] = []

  // Applicant sees only own requests
  if (user.role === 'applicant') {
    query += ' AND r.applicant_id = ?'
    params.push(user.id)
  }

  // Filter by specific applicant (admin/supplier)
  if (applicant_id && user.role !== 'applicant') {
    query += ' AND r.applicant_id = ?'
    params.push(parseInt(applicant_id))
  }

  if (status && status !== 'all') {
    query += ' AND r.status = ?'
    params.push(status)
  }

  if (priority && priority !== 'all') {
    query += ' AND r.priority = ?'
    params.push(priority)
  }

  if (project_id && project_id !== 'all') {
    query += ' AND r.project_id = ?'
    params.push(parseInt(project_id))
  }

  if (date_from) {
    query += ' AND r.created_at >= ?'
    params.push(date_from)
  }

  if (date_to) {
    query += ' AND r.created_at <= ?'
    params.push(date_to + 'T23:59:59')
  }

  if (search) {
    query += ' AND (r.product_name LIKE ? OR r.model LIKE ? OR u.full_name LIKE ? OR p.name LIKE ? OR r.request_number LIKE ?)'
    const s = `%${search}%`
    params.push(s, s, s, s, s)
  }

  // Sorting
  if (sort_by === 'priority') {
    query += ` ORDER BY CASE r.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 2 END ${sort === 'asc' ? 'ASC' : 'DESC'}, r.created_at DESC`
  } else {
    query += ` ORDER BY r.created_at ${sort === 'asc' ? 'ASC' : 'DESC'}`
  }

  const results = await c.env.DB.prepare(query).bind(...params).all()

  return c.json({ requests: results.results })
})

// ============================================================
// GET SINGLE REQUEST
// ============================================================
app.get('/:id', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const id = c.req.param('id')

  const request = await c.env.DB.prepare(`
    SELECT r.*, u.full_name as applicant_name, u.username as applicant_username, u.email as applicant_email,
           p.name as project_name
    FROM requests r
    JOIN users u ON r.applicant_id = u.id
    LEFT JOIN projects p ON r.project_id = p.id
    WHERE r.id = ?
  `).bind(id).first()

  if (!request) return c.json({ error: 'Заявка не найдена' }, 404)

  // Applicant can only see own requests
  if (user.role === 'applicant' && (request as any).applicant_id !== user.id) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  // Get files (without file_data for listing)
  const files = await c.env.DB.prepare(`
    SELECT f.id, f.file_name, f.file_size, f.mime_type, f.created_at,
           u.full_name as uploaded_by_name
    FROM request_files f
    JOIN users u ON f.uploaded_by = u.id
    WHERE f.request_id = ?
    ORDER BY f.created_at ASC
  `).bind(id).all()

  return c.json({ request, files: files.results })
})

// ============================================================
// UPDATE STATUS (supplier or admin)
// ============================================================
app.patch('/:id/status', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (!['supplier', 'admin'].includes(user.role)) return c.json({ error: 'Недостаточно прав для смены статуса' }, 403)

  const id = c.req.param('id')
  const { status, rejection_reason } = await c.req.json()

  if (!['pending', 'completed', 'rejected'].includes(status)) {
    return c.json({ error: 'Недопустимый статус' }, 400)
  }

  if (status === 'rejected' && !rejection_reason) {
    return c.json({ error: 'При отклонении необходимо указать причину' }, 400)
  }

  const request = await c.env.DB.prepare(
    'SELECT id, applicant_id, product_name, status FROM requests WHERE id = ?'
  ).bind(id).first<{ id: number; applicant_id: number; product_name: string; status: string }>()

  if (!request) return c.json({ error: 'Заявка не найдена' }, 404)

  const oldStatus = request.status

  await c.env.DB.prepare(
    'UPDATE requests SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(status, status === 'rejected' ? rejection_reason : null, id).run()

  // Audit log: status changed
  const statusLabels: Record<string, string> = {
    pending: 'На рассмотрении',
    completed: 'Исполнено',
    rejected: 'Отклонено'
  }

  await logHistory(
    c.env.DB,
    parseInt(id),
    user.id,
    'status_changed',
    oldStatus,
    status,
    status === 'rejected' ? `Причина: ${rejection_reason}` : null
  )

  // Notify applicant
  let notifMsg = `Статус заявки "${request.product_name}" изменён на: ${statusLabels[status]}`
  if (status === 'rejected' && rejection_reason) {
    notifMsg += `. Причина: ${rejection_reason}`
  }

  await c.env.DB.prepare(
    'INSERT INTO notifications (user_id, title, message, request_id) VALUES (?, ?, ?, ?)'
  ).bind(request.applicant_id, 'Статус заявки изменён', notifMsg, id).run()

  return c.json({ message: 'Статус обновлён' })
})

// ============================================================
// UPDATE PRIORITY (supplier or admin)
// ============================================================
app.patch('/:id/priority', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (!['supplier', 'admin'].includes(user.role)) return c.json({ error: 'Недостаточно прав' }, 403)

  const id = c.req.param('id')
  const { priority } = await c.req.json()

  if (!['low', 'medium', 'high', 'urgent'].includes(priority)) {
    return c.json({ error: 'Недопустимый приоритет' }, 400)
  }

  const request = await c.env.DB.prepare(
    'SELECT id, priority FROM requests WHERE id = ?'
  ).bind(id).first<{ id: number; priority: string }>()
  if (!request) return c.json({ error: 'Заявка не найдена' }, 404)

  await c.env.DB.prepare(
    'UPDATE requests SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(priority, id).run()

  await logHistory(c.env.DB, parseInt(id), user.id, 'priority_changed', request.priority, priority, null)

  return c.json({ message: 'Приоритет обновлён' })
})

// ============================================================
// UPLOAD FILE
// ============================================================
app.post('/:id/files', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const id = c.req.param('id')

  // Check request exists and access
  const request = await c.env.DB.prepare(
    'SELECT id, applicant_id FROM requests WHERE id = ?'
  ).bind(id).first<{ id: number; applicant_id: number }>()

  if (!request) return c.json({ error: 'Заявка не найдена' }, 404)

  // Only applicant (own), supplier or admin can upload
  if (user.role === 'applicant' && request.applicant_id !== user.id) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  const { file_name, mime_type, file_data } = await c.req.json()

  if (!file_name || !mime_type || !file_data) {
    return c.json({ error: 'Необходимы file_name, mime_type и file_data' }, 400)
  }

  if (!ALLOWED_MIME_TYPES.includes(mime_type)) {
    return c.json({ error: 'Недопустимый тип файла. Разрешены: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG' }, 400)
  }

  // Check file size (base64 overhead ~1.37x)
  const estimatedSize = Math.round(file_data.length * 0.75)
  if (estimatedSize > MAX_FILE_SIZE) {
    return c.json({ error: 'Файл слишком большой. Максимальный размер: 20MB' }, 400)
  }

  const result = await c.env.DB.prepare(
    'INSERT INTO request_files (request_id, uploaded_by, file_name, file_size, mime_type, file_data) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, file_name, estimatedSize, mime_type, file_data).run()

  // Audit log: file added
  await logHistory(c.env.DB, parseInt(id), user.id, 'file_added', null, file_name, null)

  return c.json({ message: 'Файл загружен', fileId: result.meta.last_row_id }, 201)
})

// ============================================================
// GET FILE (download)
// ============================================================
app.get('/:id/files/:fileId', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const id = c.req.param('id')
  const fileId = c.req.param('fileId')

  // Check request access
  const request = await c.env.DB.prepare(
    'SELECT id, applicant_id FROM requests WHERE id = ?'
  ).bind(id).first<{ id: number; applicant_id: number }>()

  if (!request) return c.json({ error: 'Заявка не найдена' }, 404)

  if (user.role === 'applicant' && request.applicant_id !== user.id) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  const file = await c.env.DB.prepare(
    'SELECT * FROM request_files WHERE id = ? AND request_id = ?'
  ).bind(fileId, id).first<{ id: number; file_name: string; mime_type: string; file_data: string; file_size: number }>()

  if (!file) return c.json({ error: 'Файл не найден' }, 404)

  return c.json({
    id: file.id,
    file_name: file.file_name,
    mime_type: file.mime_type,
    file_size: file.file_size,
    file_data: file.file_data
  })
})

// ============================================================
// DELETE FILE
// ============================================================
app.delete('/:id/files/:fileId', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const id = c.req.param('id')
  const fileId = c.req.param('fileId')

  const request = await c.env.DB.prepare(
    'SELECT id, applicant_id FROM requests WHERE id = ?'
  ).bind(id).first<{ id: number; applicant_id: number }>()

  if (!request) return c.json({ error: 'Заявка не найдена' }, 404)

  if (user.role === 'applicant' && request.applicant_id !== user.id) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  const file = await c.env.DB.prepare(
    'SELECT id, file_name FROM request_files WHERE id = ? AND request_id = ?'
  ).bind(fileId, id).first<{ id: number; file_name: string }>()

  if (!file) return c.json({ error: 'Файл не найден' }, 404)

  await c.env.DB.prepare('DELETE FROM request_files WHERE id = ?').bind(fileId).run()

  // Audit log: file removed
  await logHistory(c.env.DB, parseInt(id), user.id, 'file_removed', file.file_name, null, null)

  return c.json({ message: 'Файл удалён' })
})

// ============================================================
// GET HISTORY (Audit Log)
// ============================================================
app.get('/:id/history', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)

  const id = c.req.param('id')

  // Check access
  const request = await c.env.DB.prepare(
    'SELECT id, applicant_id FROM requests WHERE id = ?'
  ).bind(id).first<{ id: number; applicant_id: number }>()

  if (!request) return c.json({ error: 'Заявка не найдена' }, 404)

  if (user.role === 'applicant' && request.applicant_id !== user.id) {
    return c.json({ error: 'Доступ запрещён' }, 403)
  }

  const history = await c.env.DB.prepare(`
    SELECT h.*, u.full_name as user_name, u.role as user_role
    FROM request_status_history h
    JOIN users u ON h.changed_by = u.id
    WHERE h.request_id = ?
    ORDER BY h.created_at ASC
  `).bind(id).all()

  return c.json({ history: history.results })
})

// ============================================================
// STATS (supplier + admin)
// ============================================================
app.get('/stats/summary', async (c) => {
  const user = await getAuthUser(c.env.DB, c.req.header('Authorization'))
  if (!user) return c.json({ error: 'Не авторизован' }, 401)
  if (!['supplier', 'admin'].includes(user.role)) return c.json({ error: 'Доступ запрещён' }, 403)

  const total = await c.env.DB.prepare('SELECT COUNT(*) as count FROM requests').first<{ count: number }>()
  const completed = await c.env.DB.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'completed'").first<{ count: number }>()
  const rejected = await c.env.DB.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'rejected'").first<{ count: number }>()
  const pending = await c.env.DB.prepare("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'").first<{ count: number }>()
  const urgent = await c.env.DB.prepare("SELECT COUNT(*) as count FROM requests WHERE priority = 'urgent' AND status = 'pending'").first<{ count: number }>()
  const high = await c.env.DB.prepare("SELECT COUNT(*) as count FROM requests WHERE priority = 'high' AND status = 'pending'").first<{ count: number }>()

  // Users count for admin
  let usersCount = null
  if (user.role === 'admin') {
    const uc = await c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin'").first<{ count: number }>()
    usersCount = uc?.count || 0
  }

  return c.json({
    total: total?.count || 0,
    completed: completed?.count || 0,
    rejected: rejected?.count || 0,
    pending: pending?.count || 0,
    urgent: urgent?.count || 0,
    high: high?.count || 0,
    usersCount
  })
})

export default app
