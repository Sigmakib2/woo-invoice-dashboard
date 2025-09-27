import { Hono } from 'hono'
import { createClient } from '@supabase/supabase-js'
import { cors } from 'hono/cors'

type Bindings = {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  WC_API_URL: string
  WC_CONSUMER_KEY: string
  WC_CONSUMER_SECRET: string
  API_KEY: string  // API key for client endpoints
  DISCORD_WEBHOOK_URL?: string  // Optional Discord webhook URL
  ADMIN_USERNAME: string  // Admin login username
  ADMIN_PASSWORD: string  // Admin login password
  JWT_SECRET: string  // Secret for signing JWT tokens
  // ADMIN_TOKEN?: string  // uncomment if you want to guard /admin/* endpoints
}

const app = new Hono<{ Bindings: Bindings }>()

app.use(
  cors({
    origin: '*', // Allows all origins
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Specify allowed methods
    allowHeaders: ['Content-Type', 'Authorization'], // Specify allowed headers
  })
);

/** ----- JWT Utilities ----- */

async function createJWT(payload: any, secret: string, expiresIn: number = 24 * 60 * 60): Promise<string> {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }

  const now = Math.floor(Date.now() / 1000)
  const jwtPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn
  }

  const encodedHeader = btoa(JSON.stringify(header)).replace(/[+/]/g, (m) => (m === '+' ? '-' : '_')).replace(/=/g, '')
  const encodedPayload = btoa(JSON.stringify(jwtPayload)).replace(/[+/]/g, (m) => (m === '+' ? '-' : '_')).replace(/=/g, '')

  const data = `${encodedHeader}.${encodedPayload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/[+/]/g, (m) => (m === '+' ? '-' : '_')).replace(/=/g, '')

  return `${data}.${encodedSignature}`
}

async function verifyJWT(token: string, secret: string): Promise<any> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid token format')

  const [encodedHeader, encodedPayload, encodedSignature] = parts

  // Verify signature
  const data = `${encodedHeader}.${encodedPayload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

  const signature = Uint8Array.from(atob(encodedSignature.replace(/[-_]/g, (m) => (m === '-' ? '+' : '/'))), c => c.charCodeAt(0))
  const isValid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(data))

  if (!isValid) throw new Error('Invalid signature')

  // Decode payload
  const payload = JSON.parse(atob(encodedPayload.replace(/[-_]/g, (m) => (m === '-' ? '+' : '/'))))

  // Check expiration
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired')
  }

  return payload
}

/** ----- Invoice Token Utilities ----- */

function generateShortToken(length: number = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

async function createShortInvoiceToken(env: Bindings, orderData: any, expiresIn: number = 7 * 24 * 60 * 60): Promise<string> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  // Generate short token (8 characters by default)
  let shortToken = generateShortToken(8)
  
  // Ensure token is unique (check if it exists)
  let isUnique = false
  let attempts = 0
  while (!isUnique && attempts < 5) {
    const { data: existing } = await supabase
      .from('invoice_tokens')
      .select('token')
      .eq('token', shortToken)
      .single()
    
    if (!existing) {
      isUnique = true
    } else {
      shortToken = generateShortToken(8)
      attempts++
    }
  }

  if (!isUnique) {
    throw new Error('Failed to generate unique token')
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000)

  // Store token in database
  const tokenRecord = {
    token: shortToken,
    order_id: orderData.id,
    customer_email: orderData.billing?.email,
    total: orderData.total,
    currency: orderData.currency,
    created_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    is_active: true,
    access_count: 0
  }

  const { error } = await supabase
    .from('invoice_tokens')
    .insert(tokenRecord)

  if (error) {
    throw new Error(`Failed to store token: ${error.message}`)
  }

  return shortToken
}

async function getInvoiceFromToken(env: Bindings, token: string): Promise<any> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  // Get token record
  const { data: tokenRecord, error: tokenError } = await supabase
    .from('invoice_tokens')
    .select('*')
    .eq('token', token)
    .eq('is_active', true)
    .single()

  if (tokenError || !tokenRecord) {
    throw new Error('Invalid or expired invoice token')
  }

  // Check expiration
  const now = new Date()
  const expiresAt = new Date(tokenRecord.expires_at)
  
  if (now > expiresAt) {
    throw new Error('Invoice token expired')
  }

  // Increment access count
  await supabase
    .from('invoice_tokens')
    .update({ 
      access_count: tokenRecord.access_count + 1,
      last_accessed_at: new Date().toISOString()
    })
    .eq('token', token)

  return tokenRecord
}

async function hmacBase64(secret: string, rawBody: ArrayBuffer) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, rawBody)
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

function mapOrder(order: any) {
  const n = (v: any) => (v === null || v === undefined || v === '' ? null : Number(v))
  const subtotalGuess =
    n(order.total) !== null
      ? Number(order.total) -
        Number(order.total_tax ?? 0) -
        Number(order.discount_total ?? 0) -
        Number(order.shipping_total ?? 0)
      : null

  return {
    orderRow: {
      id: Number(order.id),
      status: order.status,
      currency: order.currency,
      total: n(order.total),
      subtotal: Number.isFinite(subtotalGuess as number) ? (subtotalGuess as number) : null,
      discount_total: n(order.discount_total ?? 0),
      shipping_total: n(order.shipping_total ?? 0),
      payment_method: order.payment_method ?? order.payment_method_title ?? null,
      customer_id: order.customer_id ? Number(order.customer_id) : null,
      created_at: order.date_created_gmt ? new Date(order.date_created_gmt).toISOString() : null,
      updated_at: order.date_modified_gmt ? new Date(order.date_modified_gmt).toISOString() : null,
      billing: order.billing ?? null,
      shipping: order.shipping ?? null,
      raw: order
    },
    customerRow: order.customer_id
      ? {
          id: Number(order.customer_id),
          email: order.billing?.email ?? null,
          first_name: order.billing?.first_name ?? null,
          last_name: order.billing?.last_name ?? null,
          username: order.customer_username ?? null,
          created_at: order.date_created_gmt ? new Date(order.date_created_gmt).toISOString() : null,
          updated_at: order.date_modified_gmt ? new Date(order.date_modified_gmt).toISOString() : null,
          billing: order.billing ?? null,
          shipping: order.shipping ?? null
        }
      : null,
    items: (order.line_items ?? []).map((li: any) => ({
      id: Number(li.id),
      order_id: Number(order.id),
      product_id: li.product_id ? Number(li.product_id) : null,
      variation_id: li.variation_id ? Number(li.variation_id) : null,
      name: li.name ?? null,
      quantity: li.quantity ?? null,
      price: li.price !== undefined && li.price !== null ? Number(li.price) : null,
      subtotal: li.subtotal !== undefined && li.subtotal !== null ? Number(li.subtotal) : null,
      total: li.total !== undefined && li.total !== null ? Number(li.total) : null,
      meta: li.meta_data ?? null
    }))
  }
}

async function upsertOrderBundle(env: Bindings, order: any) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })
  const { orderRow, customerRow, items } = mapOrder(order)

  if (customerRow) {
    const { error } = await supabase.from('customers').upsert(customerRow, { onConflict: 'id' })
    if (error) console.error('Customer upsert error', error)
  }

  {
    const { error } = await supabase.from('orders').upsert(orderRow, { onConflict: 'id' })
    if (error) {
      console.error('Order upsert error', error)
      return
    }
  }

  const ids = items.map(i => i.id)
  const del = await supabase
    .from('order_items')
    .delete()
    .eq('order_id', orderRow.id)
    .not('id', 'in', `(${ids.length ? ids.join(',') : 'NULL'})`)
  if (del.error) console.error('Delete missing items error', del.error)

  if (items.length) {
    const { error } = await supabase.from('order_items').upsert(items, { onConflict: 'id' })
    if (error) console.error('Items upsert error', error)
  }
}

async function fetchWooOrderById(env: Bindings, id: number) {
  const base = env.WC_API_URL.replace(/\/$/, '')
  const url = new URL(`${base}/wp-json/wc/v3/orders/${id}`)
  url.searchParams.set('consumer_key', env.WC_CONSUMER_KEY)
  url.searchParams.set('consumer_secret', env.WC_CONSUMER_SECRET)
  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Woo REST fetch failed ${r.status}`)
  return await r.json()
}

async function fetchWooOrdersPage(env: Bindings, params: { page?: number; per_page?: number; after?: string }) {
  const base = env.WC_API_URL.replace(/\/$/, '')
  const url = new URL(`${base}/wp-json/wc/v3/orders`)
  url.searchParams.set('consumer_key', env.WC_CONSUMER_KEY)
  url.searchParams.set('consumer_secret', env.WC_CONSUMER_SECRET)
  url.searchParams.set('orderby', 'date')
  url.searchParams.set('order', 'asc')
  url.searchParams.set('per_page', String(params.per_page ?? 50))
  url.searchParams.set('page', String(params.page ?? 1))
  if (params.after) url.searchParams.set('after', params.after) // ISO 8601 UTC

  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Woo REST list failed ${r.status}`)
  return (await r.json()) as any[]
}

async function fetchWooSystemStatus(env: Bindings) {
  const base = env.WC_API_URL.replace(/\/$/, '')
  const url = new URL(`${base}/wp-json/wc/v3/system_status`)
  url.searchParams.set('consumer_key', env.WC_CONSUMER_KEY)
  url.searchParams.set('consumer_secret', env.WC_CONSUMER_SECRET)
  
  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`WooCommerce system status fetch failed ${r.status}`)
  return await r.json()
}

// Add new WooCommerce product fetching functions
async function fetchWooProductById(env: Bindings, id: number) {
  const base = env.WC_API_URL.replace(/\/$/, '')
  const url = new URL(`${base}/wp-json/wc/v3/products/${id}`)
  url.searchParams.set('consumer_key', env.WC_CONSUMER_KEY)
  url.searchParams.set('consumer_secret', env.WC_CONSUMER_SECRET)
  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Woo product fetch failed ${r.status}`)
  return await r.json()
}

async function fetchWooProductsByIds(env: Bindings, productIds: number[]) {
  if (productIds.length === 0) return []
  
  const base = env.WC_API_URL.replace(/\/$/, '')
  const url = new URL(`${base}/wp-json/wc/v3/products`)
  url.searchParams.set('consumer_key', env.WC_CONSUMER_KEY)
  url.searchParams.set('consumer_secret', env.WC_CONSUMER_SECRET)
  url.searchParams.set('include', productIds.join(','))
  url.searchParams.set('per_page', '100') // Adjust as needed
  
  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Woo products fetch failed ${r.status}`)
  return await r.json()
}

/** ----- Discord Notifications ----- */

async function sendDiscordNotification(env: Bindings, orderData: any, eventType: 'created' | 'updated' | 'deleted') {
  if (!env.DISCORD_WEBHOOK_URL) {
    console.log('Discord webhook URL not configured, skipping notification')
    return
  }

  try {
    const order = orderData
    const customerName = order.billing?.first_name && order.billing?.last_name 
      ? `${order.billing.first_name} ${order.billing.last_name}`
      : order.billing?.email || 'Unknown Customer'

    // Choose embed color based on status and event
    let color = 0x5865f2 // Default Discord blue
    if (eventType === 'deleted') color = 0xed4245 // Red
    else if (order.status === 'completed') color = 0x57f287 // Green
    else if (order.status === 'processing') color = 0xfee75c // Yellow
    else if (order.status === 'pending') color = 0xf38ba8 // Pink
    else if (order.status === 'cancelled' || order.status === 'refunded') color = 0xed4245 // Red

    // Format order items
    const items = order.line_items?.slice(0, 5)?.map((item: any) => 
      `• ${item.quantity}x ${item.name} - ${Number(item.total || 0).toFixed(2)}`
    )?.join('\n') || 'No items'

    const moreItems = order.line_items?.length > 5 ? `\n... and ${order.line_items.length - 5} more items` : ''

    // Create Discord embed
    const embed = {
      title: `🛒 Order ${eventType.toUpperCase()}: #${order.id}`,
      color: color,
      fields: [
        {
          name: '👤 Customer',
          value: customerName,
          inline: true
        },
        {
          name: '💰 Total',
          value: `${Number(order.total || 0).toFixed(2)} ${order.currency || 'USD'}`,
          inline: true
        },
        {
          name: '📦 Status',
          value: order.status || 'unknown',
          inline: true
        },
        {
          name: '🛍️ Items',
          value: `${items}${moreItems}`,
          inline: false
        }
      ],
      timestamp: order.date_created_gmt || new Date().toISOString(),
      footer: {
        text: `Order ${eventType} • WooCommerce`,
        icon_url: 'https://woocommerce.com/wp-content/themes/woo/images/logo-woocommerce@2x.png'
      }
    }

    // Add additional fields based on event type
    if (eventType === 'updated') {
      embed.fields.push({
        name: '🔄 Last Updated',
        value: order.date_modified_gmt ? new Date(order.date_modified_gmt).toLocaleString() : 'Unknown',
        inline: true
      })
    }

    if (order.payment_method) {
      embed.fields.push({
        name: '💳 Payment Method',
        value: order.payment_method_title || order.payment_method,
        inline: true
      })
    }

    // Send to Discord
    const discordPayload = {
      embeds: [embed],
      username: 'WooCommerce Bot',
      avatar_url: 'https://woocommerce.com/wp-content/themes/woo/images/logo-woocommerce@2x.png'
    }

    const response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(discordPayload)
    })

    if (!response.ok) {
      console.error('Discord webhook failed:', response.status, await response.text())
    } else {
      console.log(`Discord notification sent for order ${order.id} (${eventType})`)
    }

  } catch (error) {
    console.error('Error sending Discord notification:', error)
  }
}

/** ----- Report Generation ----- */

async function generateDailyReport(env: Bindings) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  try {
    const today = new Date()
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    const startOfDay = new Date(yesterday.setHours(0, 0, 0, 0)).toISOString()
    const endOfDay = new Date(yesterday.setHours(23, 59, 59, 999)).toISOString()

    // Get yesterday's orders
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay)

    if (error) throw error

    // Calculate metrics
    const totalOrders = orders?.length || 0
    const totalRevenue = orders?.reduce((sum, order) => sum + (order.total || 0), 0) || 0
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0
    
    const statusBreakdown = orders?.reduce((acc, order) => {
      const status = order.status || 'unknown'
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {} as Record<string, number>) || {}

    // Send to Discord if configured
    if (env.DISCORD_WEBHOOK_URL) {
      const embed = {
        title: '📊 Daily Sales Report',
        description: `Report for ${yesterday.toDateString()}`,
        color: 0x00ff00,
        fields: [
          {
            name: '🛒 Total Orders',
            value: totalOrders.toString(),
            inline: true
          },
          {
            name: '💰 Total Revenue',
            value: `${totalRevenue.toFixed(2)}`,
            inline: true
          },
          {
            name: '📈 Average Order Value',
            value: `${averageOrderValue.toFixed(2)}`,
            inline: true
          },
          {
            name: '📋 Order Status Breakdown',
            value: Object.entries(statusBreakdown)
              .map(([status, count]) => `${status}: ${count}`)
              .join('\n') || 'No orders',
            inline: false
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Daily Report • WooCommerce Analytics'
        }
      }

      await fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [embed],
          username: 'Analytics Bot'
        })
      })
    }

    return {
      date: yesterday.toDateString(),
      totalOrders,
      totalRevenue,
      averageOrderValue,
      statusBreakdown
    }

  } catch (error) {
    console.error('Daily report generation failed:', error)
    throw error
  }
}

/** ----- Diagnostics ----- */

app.get('/health', c => c.text('ok'))

app.get('/_envcheck', c => {
  const e = c.env as any
  return c.json({
    SUPABASE_URL_len: e.SUPABASE_URL?.length ?? 0,
    WC_API_URL_len: e.WC_API_URL?.length ?? 0,
    WC_CONSUMER_KEY_len: e.WC_CONSUMER_KEY?.length ?? 0,
    WC_CONSUMER_SECRET_len: e.WC_CONSUMER_SECRET?.length ?? 0,
    API_KEY_len: e.API_KEY?.length ?? 0,
    DISCORD_WEBHOOK_URL_len: e.DISCORD_WEBHOOK_URL?.length ?? 0,
    ADMIN_USERNAME_len: e.ADMIN_USERNAME?.length ?? 0,
    ADMIN_PASSWORD_len: e.ADMIN_PASSWORD?.length ?? 0,
    JWT_SECRET_len: e.JWT_SECRET?.length ?? 0
  })
})

/** ----- Authentication Endpoints ----- */

// Login endpoint
app.post('/auth/login', async c => {
  try {
    const body = await c.req.json()
    const { username, password } = body

    if (!username || !password) {
      return c.json({ error: 'Username and password are required' }, 400)
    }

    // Verify credentials
    if (username !== c.env.ADMIN_USERNAME || password !== c.env.ADMIN_PASSWORD) {
      return c.json({ error: 'Invalid username or password' }, 401)
    }

    // Create JWT token
    const tokenPayload = {
      username: username,
      role: 'admin',
      loginTime: new Date().toISOString()
    }

    const token = await createJWT(tokenPayload, c.env.JWT_SECRET, 24 * 60 * 60) // 24 hours

    return c.json({
      success: true,
      token,
      user: {
        username: username,
        role: 'admin',
        loginTime: tokenPayload.loginTime
      },
      expiresIn: 24 * 60 * 60 // seconds
    })

  } catch (e: any) {
    return c.json({ error: 'Login failed', details: e?.message }, 500)
  }
})

// Verify token endpoint
app.get('/auth/verify', async c => {
  try {
    const authHeader = c.req.header('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid authorization header' }, 401)
    }

    const token = authHeader.substring(7) // Remove 'Bearer '
    const payload = await verifyJWT(token, c.env.JWT_SECRET)

    return c.json({
      valid: true,
      user: {
        username: payload.username,
        role: payload.role,
        loginTime: payload.loginTime
      },
      expiresAt: new Date(payload.exp * 1000).toISOString()
    })

  } catch (e: any) {
    return c.json({ 
      valid: false, 
      error: e?.message === 'Token expired' ? 'Token expired' : 'Invalid token' 
    }, 401)
  }
})

// Refresh token endpoint
app.post('/auth/refresh', async c => {
  try {
    const authHeader = c.req.header('authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid authorization header' }, 401)
    }

    const token = authHeader.substring(7)
    const payload = await verifyJWT(token, c.env.JWT_SECRET)

    // Create new token with extended expiration
    const newTokenPayload = {
      username: payload.username,
      role: payload.role,
      loginTime: payload.loginTime,
      refreshedAt: new Date().toISOString()
    }

    const newToken = await createJWT(newTokenPayload, c.env.JWT_SECRET, 24 * 60 * 60)

    return c.json({
      success: true,
      token: newToken,
      user: {
        username: payload.username,
        role: payload.role,
        loginTime: payload.loginTime,
        refreshedAt: newTokenPayload.refreshedAt
      },
      expiresIn: 24 * 60 * 60
    })

  } catch (e: any) {
    return c.json({ error: 'Token refresh failed', details: e?.message }, 401)
  }
})

// Logout endpoint (client-side token removal, but we can log it)
app.post('/auth/logout', async c => {
  try {
    const authHeader = c.req.header('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7)
      try {
        const payload = await verifyJWT(token, c.env.JWT_SECRET)
        console.log(`User ${payload.username} logged out at ${new Date().toISOString()}`)
      } catch (e) {
        // Token might be invalid/expired, that's okay for logout
      }
    }

    return c.json({
      success: true,
      message: 'Logged out successfully'
    })

  } catch (e: any) {
    return c.json({ error: 'Logout failed' }, 500)
  }
})

/** ----- JWT Authentication Middleware ----- */

// Middleware for JWT authentication
async function authenticateJWT(c: any, next: any) {
  const authHeader = c.req.header('authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header. Please login first.' }, 401)
  }

  try {
    const token = authHeader.substring(7)
    const payload = await verifyJWT(token, c.env.JWT_SECRET)
    
    // Add user info to context
    c.set('user', {
      username: payload.username,
      role: payload.role,
      loginTime: payload.loginTime
    })
    
    return next()
  } catch (e: any) {
    return c.json({ 
      error: e?.message === 'Token expired' 
        ? 'Token expired. Please login again.' 
        : 'Invalid token. Please login again.',
      code: e?.message === 'Token expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
    }, 401)
  }
}

/** ----- API Authentication Middleware (Updated) ----- */

app.use('/api/*', async (c, next) => {
  // Check for API key (backward compatibility)
  const apiKey = c.req.header('x-api-key') || 
                 c.req.header('authorization')?.replace('Bearer ', '') ||
                 new URL(c.req.url).searchParams.get('api_key') || ''
  
  // If API key is provided and valid, allow access
  if (apiKey && c.env.API_KEY && apiKey === c.env.API_KEY) {
    return next()
  }
  
  // Otherwise, require JWT authentication
  const authHeader = c.req.header('authorization')
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header. Please login first.' }, 401)
  }

  try {
    const token = authHeader.substring(7)
    const payload = await verifyJWT(token, c.env.JWT_SECRET)
    
    // Add user info to context
    c.set('user', {
      username: payload.username,
      role: payload.role,
      loginTime: payload.loginTime
    })
    
    return next()
  } catch (e: any) {
    return c.json({ 
      error: e?.message === 'Token expired' 
        ? 'Token expired. Please login again.' 
        : 'Invalid token. Please login again.',
      code: e?.message === 'Token expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
    }, 401)
  }
})

/** ----- Admin Endpoints (JWT Protected) ----- */

// Protect admin endpoints with JWT
app.use('/admin/*', authenticateJWT)

/** ----- Invoice Endpoints ----- */

// Generate invoice token for an order (Admin only)
app.post('/admin/invoice/generate', async c => {
  try {
    const body = await c.req.json()
    const { order_id, expires_in, token_length } = body

    if (!order_id) {
      return c.json({ error: 'order_id is required' }, 400)
    }

    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single()

    if (orderError) throw orderError
    if (!order) return c.json({ error: 'Order not found' }, 404)

    // Generate short invoice token (default 7 days expiration)
    const expirationTime = expires_in || (7 * 24 * 60 * 60) // 7 days default
    const invoiceToken = await createShortInvoiceToken(c.env, order, expirationTime)

    // Log token generation
    console.log(`Invoice token ${invoiceToken} generated for order ${order_id} by ${c.get('user')?.username}`)

    return c.json({
      success: true,
      order_id: order_id,
      invoice_token: invoiceToken,
      expires_in: expirationTime,
      expires_at: new Date(Date.now() + expirationTime * 1000).toISOString(),
      invoice_url: `https://invoice.yourdomain.com/k?token=${invoiceToken}`,
      short_url: `https://invoice.yourdomain.com/k?=${invoiceToken}`, // Even shorter format
      created_by: c.get('user')?.username,
      created_at: new Date().toISOString()
    })

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Enhanced Order Search API with comprehensive search capabilities
app.get('/api/search/orders', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const query = url.searchParams.get('q') || ''
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20')))
  const cursor = url.searchParams.get('cursor') || undefined
  const sort_direction = url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc'
  
  // Specific search filters
  const email = url.searchParams.get('email') || ''
  const phone = url.searchParams.get('phone') || ''
  const name = url.searchParams.get('name') || ''
  const address = url.searchParams.get('address') || ''
  const order_id = url.searchParams.get('order_id') || ''
  const customer_id = url.searchParams.get('customer_id') || ''
  const customer_ip = url.searchParams.get('customer_ip') || ''
  
  // Date filters
  const from_date = url.searchParams.get('from_date') || undefined
  const to_date = url.searchParams.get('to_date') || undefined
  
  // Status filter
  const status = url.searchParams.get('status') || undefined

  if (!query.trim() && !email && !phone && !name && !address && !order_id && !customer_id && !customer_ip) {
    return c.json({ error: 'Search query or specific filter is required' }, 400)
  }

  try {
    let searchQuery = supabase
      .from('orders')
      .select(`
        id,
        status,
        total,
        subtotal,
        currency,
        payment_method,
        customer_id,
        created_at,
        updated_at,
        billing,
        shipping,
        raw
      `)
      .order('created_at', { ascending: sort_direction === 'asc' })
      .order('id', { ascending: sort_direction === 'asc' })
      .limit(limit + 1)

    // Build search conditions array
    const searchConditions: string[] = []

    // General query search across multiple fields
    if (query.trim()) {
      const q = query.trim()
      
      // Check if query is a number (could be order ID or customer ID)
      if (!isNaN(Number(q))) {
        searchConditions.push(`id.eq.${Number(q)}`)
        searchConditions.push(`customer_id.eq.${Number(q)}`)
      }
      
      // Search in billing information
      searchConditions.push(`billing->>email.ilike.%${q}%`)
      searchConditions.push(`billing->>first_name.ilike.%${q}%`)
      searchConditions.push(`billing->>last_name.ilike.%${q}%`)
      searchConditions.push(`billing->>phone.ilike.%${q}%`)
      searchConditions.push(`billing->>company.ilike.%${q}%`)
      searchConditions.push(`billing->>address_1.ilike.%${q}%`)
      searchConditions.push(`billing->>address_2.ilike.%${q}%`)
      searchConditions.push(`billing->>city.ilike.%${q}%`)
      searchConditions.push(`billing->>state.ilike.%${q}%`)
      searchConditions.push(`billing->>postcode.ilike.%${q}%`)
      
      // Search in shipping information
      searchConditions.push(`shipping->>first_name.ilike.%${q}%`)
      searchConditions.push(`shipping->>last_name.ilike.%${q}%`)
      searchConditions.push(`shipping->>company.ilike.%${q}%`)
      searchConditions.push(`shipping->>address_1.ilike.%${q}%`)
      searchConditions.push(`shipping->>address_2.ilike.%${q}%`)
      searchConditions.push(`shipping->>city.ilike.%${q}%`)
      searchConditions.push(`shipping->>state.ilike.%${q}%`)
      searchConditions.push(`shipping->>postcode.ilike.%${q}%`)
      
      // Search in raw data for customer IP and other fields
      searchConditions.push(`raw->>customer_ip_address.ilike.%${q}%`)
      searchConditions.push(`raw->>order_key.ilike.%${q}%`)
    }

    // Specific field searches
    if (email) {
      searchConditions.length = 0 // Reset if specific email search
      searchConditions.push(`billing->>email.ilike.%${email}%`)
    }

    if (phone) {
      if (searchConditions.length === 0 || !query.trim()) {
        searchConditions.length = 0
        searchConditions.push(`billing->>phone.ilike.%${phone}%`)
      } else {
        searchConditions.push(`billing->>phone.ilike.%${phone}%`)
      }
    }

    if (name) {
      const nameConditions = [
        `billing->>first_name.ilike.%${name}%`,
        `billing->>last_name.ilike.%${name}%`,
        `shipping->>first_name.ilike.%${name}%`,
        `shipping->>last_name.ilike.%${name}%`
      ]
      if (searchConditions.length === 0 || !query.trim()) {
        searchConditions.length = 0
        searchConditions.push(...nameConditions)
      } else {
        searchConditions.push(...nameConditions)
      }
    }

    if (address) {
      const addressConditions = [
        `billing->>address_1.ilike.%${address}%`,
        `billing->>address_2.ilike.%${address}%`,
        `billing->>city.ilike.%${address}%`,
        `billing->>state.ilike.%${address}%`,
        `billing->>postcode.ilike.%${address}%`,
        `shipping->>address_1.ilike.%${address}%`,
        `shipping->>address_2.ilike.%${address}%`,
        `shipping->>city.ilike.%${address}%`,
        `shipping->>state.ilike.%${address}%`,
        `shipping->>postcode.ilike.%${address}%`
      ]
      if (searchConditions.length === 0 || !query.trim()) {
        searchConditions.length = 0
        searchConditions.push(...addressConditions)
      } else {
        searchConditions.push(...addressConditions)
      }
    }

    if (order_id) {
      if (searchConditions.length === 0 || !query.trim()) {
        searchConditions.length = 0
      }
      if (!isNaN(Number(order_id))) {
        searchConditions.push(`id.eq.${Number(order_id)}`)
      }
    }

    if (customer_id) {
      if (searchConditions.length === 0 || !query.trim()) {
        searchConditions.length = 0
      }
      if (!isNaN(Number(customer_id))) {
        searchConditions.push(`customer_id.eq.${Number(customer_id)}`)
      }
    }

    if (customer_ip) {
      if (searchConditions.length === 0 || !query.trim()) {
        searchConditions.length = 0
        searchConditions.push(`raw->>customer_ip_address.ilike.%${customer_ip}%`)
      } else {
        searchConditions.push(`raw->>customer_ip_address.ilike.%${customer_ip}%`)
      }
    }

    // Apply OR condition for search
    if (searchConditions.length > 0) {
      searchQuery = searchQuery.or(searchConditions.join(','))
    }

    // Apply additional filters with AND conditions
    if (status) {
      searchQuery = searchQuery.eq('status', status)
    }
    
    if (from_date) {
      searchQuery = searchQuery.gte('created_at', from_date)
    }
    
    if (to_date) {
      searchQuery = searchQuery.lte('created_at', to_date)
    }

    // Apply cursor pagination
    if (cursor) {
      if (sort_direction === 'desc') {
        searchQuery = searchQuery.lt('id', Number(cursor))
      } else {
        searchQuery = searchQuery.gt('id', Number(cursor))
      }
    }

    const { data, error } = await searchQuery
    if (error) throw error

    let orders = data || []
    let hasNext = false
    let nextCursor = null

    // Check for next page
    if (orders.length > limit) {
      hasNext = true
      orders = orders.slice(0, limit)
    }

    if (orders.length > 0) {
      nextCursor = orders[orders.length - 1].id
    }

    // Enhance results with extracted information for better display
    const enhancedOrders = orders.map(order => ({
      ...order,
      // Extract key information for easy display
      customer_info: {
        email: order.billing?.email || null,
        name: order.billing?.first_name && order.billing?.last_name 
          ? `${order.billing.first_name} ${order.billing.last_name}`
          : order.billing?.first_name || order.billing?.last_name || null,
        phone: order.billing?.phone || null,
        company: order.billing?.company || null,
        ip_address: order.raw?.customer_ip_address || null
      },
      billing_address: {
        full_address: [
          order.billing?.address_1,
          order.billing?.address_2,
          order.billing?.city,
          order.billing?.state,
          order.billing?.postcode,
          order.billing?.country
        ].filter(Boolean).join(', ') || null,
        city: order.billing?.city || null,
        state: order.billing?.state || null,
        country: order.billing?.country || null,
        postcode: order.billing?.postcode || null
      },
      shipping_address: order.shipping ? {
        full_address: [
          order.shipping.address_1,
          order.shipping.address_2,
          order.shipping.city,
          order.shipping.state,
          order.shipping.postcode,
          order.shipping.country
        ].filter(Boolean).join(', ') || null,
        city: order.shipping.city || null,
        state: order.shipping.state || null,
        country: order.shipping.country || null,
        postcode: order.shipping.postcode || null
      } : null,
      // Keep original data for full access
      billing: order.billing,
      shipping: order.shipping,
      raw: order.raw
    }))

    const response = {
      orders: enhancedOrders,
      search_info: {
        query: query || null,
        filters: {
          email: email || null,
          phone: phone || null,
          name: name || null,
          address: address || null,
          order_id: order_id || null,
          customer_id: customer_id || null,
          customer_ip: customer_ip || null,
          status: status || null,
          from_date: from_date || null,
          to_date: to_date || null
        },
        results_count: enhancedOrders.length,
        search_conditions_used: searchConditions.length
      },
      pagination: {
        type: 'cursor',
        limit,
        has_next: hasNext,
        next_cursor: hasNext ? nextCursor : null,
        sort_direction
      }
    }

    return c.json(response)

  } catch (e: any) {
    console.error('Search error:', e)
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Quick search suggestions endpoint
app.get('/api/search/suggestions', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const query = url.searchParams.get('q') || ''
  const type = url.searchParams.get('type') || 'all' // email, phone, name, address, all
  const limit = Math.min(10, Math.max(1, Number(url.searchParams.get('limit') ?? '5')))

  if (!query.trim() || query.length < 2) {
    return c.json({ error: 'Query must be at least 2 characters long' }, 400)
  }

  try {
    const suggestions: any = {
      query,
      type,
      suggestions: []
    }

    let searchQuery = supabase
      .from('orders')
      .select('id, billing, shipping, raw')
      .limit(limit * 3) // Get more to filter unique suggestions

    // Build search based on type
    const searchConditions: string[] = []
    const q = query.trim()

    if (type === 'email' || type === 'all') {
      searchConditions.push(`billing->>email.ilike.%${q}%`)
    }

    if (type === 'phone' || type === 'all') {
      searchConditions.push(`billing->>phone.ilike.%${q}%`)
    }

    if (type === 'name' || type === 'all') {
      searchConditions.push(`billing->>first_name.ilike.%${q}%`)
      searchConditions.push(`billing->>last_name.ilike.%${q}%`)
      searchConditions.push(`shipping->>first_name.ilike.%${q}%`)
      searchConditions.push(`shipping->>last_name.ilike.%${q}%`)
    }

    if (type === 'address' || type === 'all') {
      searchConditions.push(`billing->>address_1.ilike.%${q}%`)
      searchConditions.push(`billing->>city.ilike.%${q}%`)
      searchConditions.push(`billing->>state.ilike.%${q}%`)
      searchConditions.push(`billing->>postcode.ilike.%${q}%`)
      searchConditions.push(`shipping->>address_1.ilike.%${q}%`)
      searchConditions.push(`shipping->>city.ilike.%${q}%`)
      searchConditions.push(`shipping->>state.ilike.%${q}%`)
      searchConditions.push(`shipping->>postcode.ilike.%${q}%`)
    }

    if (searchConditions.length > 0) {
      searchQuery = searchQuery.or(searchConditions.join(','))
    }

    const { data: orders, error } = await searchQuery
    if (error) throw error

    // Extract unique suggestions
    const uniqueSuggestions = new Set<string>()

    orders?.forEach(order => {
      if (type === 'email' || type === 'all') {
        const email = order.billing?.email
        if (email && email.toLowerCase().includes(q.toLowerCase())) {
          uniqueSuggestions.add(email)
        }
      }

      if (type === 'phone' || type === 'all') {
        const phone = order.billing?.phone
        if (phone && phone.includes(q)) {
          uniqueSuggestions.add(phone)
        }
      }

      if (type === 'name' || type === 'all') {
        const firstName = order.billing?.first_name
        const lastName = order.billing?.last_name
        if (firstName && firstName.toLowerCase().includes(q.toLowerCase())) {
          uniqueSuggestions.add(firstName)
        }
        if (lastName && lastName.toLowerCase().includes(q.toLowerCase())) {
          uniqueSuggestions.add(lastName)
        }
        if (firstName && lastName) {
          const fullName = `${firstName} ${lastName}`
          if (fullName.toLowerCase().includes(q.toLowerCase())) {
            uniqueSuggestions.add(fullName)
          }
        }
      }

      if (type === 'address' || type === 'all') {
        [order.billing, order.shipping].forEach(addr => {
          if (!addr) return
          
          if (addr.address_1 && addr.address_1.toLowerCase().includes(q.toLowerCase())) {
            uniqueSuggestions.add(addr.address_1)
          }
          if (addr.city && addr.city.toLowerCase().includes(q.toLowerCase())) {
            uniqueSuggestions.add(addr.city)
          }
          if (addr.state && addr.state.toLowerCase().includes(q.toLowerCase())) {
            uniqueSuggestions.add(addr.state)
          }
          if (addr.postcode && addr.postcode.includes(q)) {
            uniqueSuggestions.add(addr.postcode)
          }
        })
      }
    })

    suggestions.suggestions = Array.from(uniqueSuggestions).slice(0, limit)

    return c.json(suggestions)

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Legacy search API (for backward compatibility)
app.get('/api/search', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const query = url.searchParams.get('q') || ''
  const type = url.searchParams.get('type') || 'all' // orders, customers, all
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? '20')))

  if (!query.trim()) {
    return c.json({ error: 'Search query is required' }, 400)
  }

  try {
    const results: any = {
      query,
      orders: [],
      customers: []
    }

    // Search orders
    if (type === 'orders' || type === 'all') {
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, status, total, customer_id, created_at, billing, raw')
        .or(`id.eq.${isNaN(Number(query)) ? 0 : Number(query)},billing->>email.ilike.%${query}%,billing->>first_name.ilike.%${query}%,billing->>last_name.ilike.%${query}%`)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (ordersError) throw ordersError
      results.orders = orders || []
    }

    // Search customers
    if (type === 'customers' || type === 'all') {
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('id, email, first_name, last_name, created_at')
        .or(`id.eq.${isNaN(Number(query)) ? 0 : Number(query)},email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (customersError) throw customersError
      results.customers = customers || []
    }

    // Add search metadata
    results.metadata = {
      total_results: results.orders.length + results.customers.length,
      orders_found: results.orders.length,
      customers_found: results.customers.length,
      search_type: type
    }

    return c.json(results)

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Get all generated invoice tokens for an order (Admin only)
app.get('/admin/invoice/tokens/:order_id', async c => {
  try {
    const order_id = Number(c.req.param('order_id'))
    if (!order_id) return c.json({ error: 'Invalid order ID' }, 400)

    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    // Get all tokens for this order
    const { data: tokens, error } = await supabase
      .from('invoice_tokens')
      .select('token, created_at, expires_at, is_active, access_count, last_accessed_at')
      .eq('order_id', order_id)
      .order('created_at', { ascending: false })

    if (error) throw error

    return c.json({
      order_id,
      tokens: tokens || [],
      total_tokens: tokens?.length || 0,
      active_tokens: tokens?.filter(t => t.is_active && new Date(t.expires_at) > new Date()).length || 0
    })

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Revoke invoice token (Admin only)
app.post('/admin/invoice/revoke/:token', async c => {
  try {
    const token = c.req.param('token')
    if (!token) return c.json({ error: 'Token is required' }, 400)

    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    const { data, error } = await supabase
      .from('invoice_tokens')
      .update({ 
        is_active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: c.get('user')?.username
      })
      .eq('token', token)
      .select()
      .single()

    if (error) throw error
    if (!data) return c.json({ error: 'Token not found' }, 404)

    console.log(`Invoice token ${token} revoked by ${c.get('user')?.username}`)

    return c.json({
      success: true,
      message: 'Token revoked successfully',
      token: token,
      revoked_by: c.get('user')?.username,
      revoked_at: new Date().toISOString()
    })

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Public invoice endpoint with product images (No authentication required)
app.get('/invoice', async c => {
  try {
    const token = new URL(c.req.url).searchParams.get('token') || 
                  new URL(c.req.url).searchParams.get('') // Support both ?token=ABC and ?=ABC
    
    if (!token) {
      return c.json({ error: 'Invoice token is required' }, 400)
    }

    // Get token data from database
    const tokenRecord = await getInvoiceFromToken(c.env, token)

    const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    })

    // Get current order data
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', tokenRecord.order_id)
      .single()

    if (orderError) throw orderError
    if (!order) return c.json({ error: 'Order not found' }, 404)

    // Get order items
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', tokenRecord.order_id)
      .order('id')

    if (itemsError) throw itemsError

    // Extract unique product IDs from order items
    const productIds = [...new Set(
      (items || [])
        .map(item => item.product_id)
        .filter(id => id && id > 0)
    )]

    // Fetch product data from WooCommerce (including images)
    let productsData: any[] = []
    try {
      if (productIds.length > 0) {
        productsData = await fetchWooProductsByIds(c.env, productIds)
      }
    } catch (e) {
      console.error('Failed to fetch product data:', e)
      // Continue without product data - don't fail the whole request
    }

    // Create a map of product ID to product data for quick lookup
    const productMap = new Map()
    productsData.forEach(product => {
      productMap.set(product.id, product)
    })

    // Enhanced items with product images and details
    const enhancedItems = (items || []).map(item => {
      const product = productMap.get(item.product_id)
      
      return {
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal,
        total: item.total,
        product_id: item.product_id,
        variation_id: item.variation_id,
        // Add product image information
        image: product?.images?.[0] ? {
          id: product.images[0].id,
          src: product.images[0].src,
          alt: product.images[0].alt || item.name,
          thumbnail: product.images[0].src?.replace(/\.(jpg|jpeg|png|gif)$/i, '-150x150.$1') || product.images[0].src
        } : null,
        // Add additional product details if available
        product_details: product ? {
          sku: product.sku,
          weight: product.weight,
          dimensions: product.dimensions,
          categories: product.categories?.map((cat: any) => ({
            id: cat.id,
            name: cat.name,
            slug: cat.slug
          })) || [],
          short_description: product.short_description,
          permalink: product.permalink
        } : null
      }
    })

    // Create invoice response with enhanced items
    const invoice = {
      invoice_info: {
        token: token,
        token_created_at: tokenRecord.created_at,
        token_expires_at: tokenRecord.expires_at,
        access_count: tokenRecord.access_count,
        accessed_at: new Date().toISOString()
      },
      order: {
        id: order.id,
        order_number: order.id,
        status: order.status,
        created_at: order.created_at,
        updated_at: order.updated_at
      },
      customer: {
        email: order.billing?.email,
        name: order.billing?.first_name && order.billing?.last_name 
          ? `${order.billing.first_name} ${order.billing.last_name}`
          : order.billing?.first_name || order.billing?.last_name || 'Guest',
        company: order.billing?.company || null
      },
      billing_address: {
        name: order.billing?.first_name && order.billing?.last_name 
          ? `${order.billing.first_name} ${order.billing.last_name}`
          : order.billing?.first_name || order.billing?.last_name || '',
        company: order.billing?.company || '',
        address_1: order.billing?.address_1 || '',
        address_2: order.billing?.address_2 || '',
        city: order.billing?.city || '',
        state: order.billing?.state || '',
        postcode: order.billing?.postcode || '',
        country: order.billing?.country || '',
        email: order.billing?.email || '',
        phone: order.billing?.phone || ''
      },
      shipping_address: order.shipping ? {
        name: order.shipping?.first_name && order.shipping?.last_name 
          ? `${order.shipping.first_name} ${order.shipping.last_name}`
          : order.shipping?.first_name || order.shipping?.last_name || '',
        company: order.shipping?.company || '',
        address_1: order.shipping?.address_1 || '',
        address_2: order.shipping?.address_2 || '',
        city: order.shipping?.city || '',
        state: order.shipping?.state || '',
        postcode: order.shipping?.postcode || '',
        country: order.shipping?.country || '',
        //email: order.shipping?.email || '',
        phone: order.shipping?.phone || ''
      } : null,
      items: enhancedItems, // Use enhanced items with images
      totals: {
        subtotal: order.subtotal,
        discount_total: order.discount_total || 0,
        shipping_total: order.shipping_total || 0,
        tax_total: (order.total || 0) - (order.subtotal || 0) - (order.shipping_total || 0) + (order.discount_total || 0),
        total: order.total,
        currency: order.currency || 'USD'
      },
      payment: {
        method: order.payment_method,
        status: order.status
      },
      // Add metadata about product data fetch
      meta: {
        products_fetched: productsData.length,
        items_with_images: enhancedItems.filter(item => item.image).length
      }
    }

    // Set CORS headers for cross-domain access
    const response = c.json(invoice)
    response.headers.set('Access-Control-Allow-Origin', '*')
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type')

    return response

  } catch (e: any) {
    const errorResponse = c.json({ 
      error: e?.message === 'Invoice token expired' 
        ? 'This invoice link has expired. Please request a new one.'
        : e?.message || 'Invalid or malformed invoice token',
      code: e?.message === 'Invoice token expired' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
    }, 401)
    
    // Set CORS headers even for errors
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
})

// Options endpoint for CORS preflight
app.options('/invoice', async c => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
})

/** ----- Admin helpers ----- */

app.get('/admin/fetch', async c => {
  const id = Number(new URL(c.req.url).searchParams.get('id'))
  if (!id) return c.text('id required', 400)
  try {
    const order = await fetchWooOrderById(c.env, id)
    await upsertOrderBundle(c.env, order)
    return c.json({ ok: true, id })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? String(e) }, 500)
  }
})

// WooCommerce System Status
app.get('/admin/woo-status', async c => {
  try {
    const systemStatus = await fetchWooSystemStatus(c.env)
    
    // Extract key information
    const summary = {
      woocommerce_version: systemStatus.settings?.version || 'Unknown',
      wordpress_version: systemStatus.environment?.wp_version || 'Unknown',
      php_version: systemStatus.environment?.php_version || 'Unknown',
      mysql_version: systemStatus.environment?.mysql_version || 'Unknown',
      server_info: systemStatus.environment?.server_info || 'Unknown',
      max_upload_size: systemStatus.environment?.max_upload_size || 'Unknown',
      memory_limit: systemStatus.environment?.php_memory_limit || 'Unknown',
      active_plugins: systemStatus.active_plugins?.length || 0,
      theme: systemStatus.theme?.name || 'Unknown',
      currency: systemStatus.settings?.currency || 'Unknown',
      tax_enabled: systemStatus.settings?.tax_enabled || false,
      shipping_enabled: systemStatus.settings?.shipping_enabled || false
    }
    
    return c.json({
      ok: true,
      summary,
      full_status: systemStatus
    })
    
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? String(e) }, 500)
  }
})

// WooCommerce Connection Test
app.get('/admin/woo-test', async c => {
  const tests = []
  
  try {
    // Test 1: Basic API connectivity
    try {
      await fetchWooSystemStatus(c.env)
      tests.push({ test: 'API Connection', status: 'PASS', message: 'Successfully connected to WooCommerce API' })
    } catch (e: any) {
      tests.push({ test: 'API Connection', status: 'FAIL', message: e.message })
    }
    
    // Test 2: Orders endpoint
    try {
      await fetchWooOrdersPage(c.env, { page: 1, per_page: 1 })
      tests.push({ test: 'Orders Access', status: 'PASS', message: 'Can access orders endpoint' })
    } catch (e: any) {
      tests.push({ test: 'Orders Access', status: 'FAIL', message: e.message })
    }
    
    // Test 3: Environment variables
    const envTests = [
      { name: 'WC_API_URL', value: c.env.WC_API_URL },
      { name: 'WC_CONSUMER_KEY', value: c.env.WC_CONSUMER_KEY },
      { name: 'WC_CONSUMER_SECRET', value: c.env.WC_CONSUMER_SECRET }
    ]
    
    envTests.forEach(envTest => {
      if (envTest.value && envTest.value.length > 0) {
        tests.push({ 
          test: `Environment: ${envTest.name}`, 
          status: 'PASS', 
          message: `${envTest.name} is configured (${envTest.value.length} chars)` 
        })
      } else {
        tests.push({ 
          test: `Environment: ${envTest.name}`, 
          status: 'FAIL', 
          message: `${envTest.name} is missing or empty` 
        })
      }
    })
    
    const passedTests = tests.filter(t => t.status === 'PASS').length
    const totalTests = tests.length
    
    return c.json({
      ok: passedTests === totalTests,
      summary: `${passedTests}/${totalTests} tests passed`,
      tests
    })
    
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? String(e), tests }, 500)
  }
})

// Generate manual report
app.get('/admin/report', async c => {
  const type = new URL(c.req.url).searchParams.get('type') || 'daily'
  
  try {
    if (type === 'daily') {
      const report = await generateDailyReport(c.env)
      return c.json({ ok: true, report })
    }
    
    return c.json({ ok: false, error: 'Invalid report type' }, 400)
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? String(e) }, 500)
  }
})

app.get('/admin/backfill', async c => {
  const u = new URL(c.req.url)
  const page = Number(u.searchParams.get('page') ?? '1')
  const per = Math.min(Number(u.searchParams.get('per_page') ?? '50'), 100)
  const after = u.searchParams.get('after') ?? undefined

  try {
    const list = await fetchWooOrdersPage(c.env, { page, per_page: per, after })
    for (const o of list) await upsertOrderBundle(c.env, o)
    return c.json({ ok: true, count: list.length, nextPage: list.length ? page + 1 : null })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message ?? String(e) }, 500)
  }
})

app.get('/admin/sync', async c => {
  const u = new URL(c.req.url)
  const maxPages = Math.min(Number(u.searchParams.get('max_pages') ?? '10'), 50)
  const perPage = Math.min(Number(u.searchParams.get('per_page') ?? '50'), 100)
  
  console.log('=== STARTING FULL SYNC ===')
  console.log('max_pages:', maxPages, 'per_page:', perPage)
  
  let totalSynced = 0
  let currentPage = 1
  
  try {
    while (currentPage <= maxPages) {
      console.log(`Fetching page ${currentPage}...`)
      
      const list = await fetchWooOrdersPage(c.env, { 
        page: currentPage, 
        per_page: perPage 
      })
      
      if (list.length === 0) {
        console.log('No more orders found, stopping sync')
        break
      }
      
      console.log(`Processing ${list.length} orders from page ${currentPage}`)
      
      for (const order of list) {
        try {
          await upsertOrderBundle(c.env, order)
          totalSynced++
        } catch (e) {
          console.error(`Failed to sync order ${order.id}:`, e)
        }
      }
      
      // If we got less than requested per_page, we're done
      if (list.length < perPage) {
        console.log('Reached end of orders (partial page)')
        break
      }
      
      currentPage++
    }
    
    console.log('=== SYNC COMPLETED ===')
    console.log('total_synced:', totalSynced)
    
    return c.json({ 
      ok: true, 
      total_synced: totalSynced, 
      pages_processed: currentPage - 1,
      message: `Successfully synced ${totalSynced} orders`
    })
    
  } catch (e: any) {
    console.error('Sync failed:', e)
    return c.json({ 
      ok: false, 
      error: e?.message ?? String(e),
      total_synced: totalSynced,
      pages_processed: currentPage - 1
    }, 500)
  }
})

/** ----- Client API Endpoints ----- */

// Get orders with pagination and filtering
app.get('/api/orders', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20')))
  const cursor = url.searchParams.get('cursor') || undefined // cursor = order ID
  const status = url.searchParams.get('status') || undefined
  const customer_id = url.searchParams.get('customer_id') ? Number(url.searchParams.get('customer_id')) : undefined
  const from_date = url.searchParams.get('from_date') || undefined
  const to_date = url.searchParams.get('to_date') || undefined
  const sort_direction = url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc'
  
  // Support legacy pagination for backward compatibility
  const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined
  const useLegacyPagination = page && !cursor

  try {
    let query = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: sort_direction === 'asc' })
      .order('id', { ascending: sort_direction === 'asc' }) // Secondary sort for consistency
      .limit(limit + 1) // Get one extra to determine if there's a next page

    // Apply filters
    if (status) query = query.eq('status', status)
    if (customer_id) query = query.eq('customer_id', customer_id)
    if (from_date) query = query.gte('created_at', from_date)
    if (to_date) query = query.lte('created_at', to_date)

    // Apply cursor-based pagination
    if (cursor && !useLegacyPagination) {
      if (sort_direction === 'desc') {
        query = query.lt('id', Number(cursor))
      } else {
        query = query.gt('id', Number(cursor))
      }
    }

    // Legacy offset pagination (less stable but familiar)
    if (useLegacyPagination) {
      const offset = Math.max(0, (page - 1) * limit)
      query = query.range(offset, offset + limit - 1)
    }

    const { data, error } = await query
    if (error) throw error

    let orders = data || []
    let hasNext = false
    let nextCursor = null

    if (!useLegacyPagination) {
      // Check if we have more results
      if (orders.length > limit) {
        hasNext = true
        orders = orders.slice(0, limit) // Remove the extra item
      }

      // Set next cursor to the last item's ID
      if (orders.length > 0) {
        nextCursor = orders[orders.length - 1].id
      }
    }

    // For legacy pagination, get total count
    let totalCount = 0
    let totalPages = 0
    if (useLegacyPagination) {
      let countQuery = supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })

      if (status) countQuery = countQuery.eq('status', status)
      if (customer_id) countQuery = countQuery.eq('customer_id', customer_id)
      if (from_date) countQuery = countQuery.gte('created_at', from_date)
      if (to_date) countQuery = countQuery.lte('created_at', to_date)

      const { count, error: countError } = await countQuery
      if (countError) throw countError

      totalCount = count || 0
      totalPages = Math.ceil(totalCount / limit)
    }

    const response: any = {
      orders,
      pagination: useLegacyPagination ? {
        // Legacy pagination
        type: 'offset',
        page: page,
        limit,
        total: totalCount,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1
      } : {
        // Cursor pagination
        type: 'cursor',
        limit,
        has_next: hasNext,
        next_cursor: hasNext ? nextCursor : null,
        sort_direction
      }
    }

    return c.json(response)
  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

/** ----- CSV Export Functions ----- */

function escapeCSV(field: any): string {
  if (field === null || field === undefined) return ''
  const str = String(field)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function generateOrdersCSV(orders: any[]): string {
  const headers = [
    'Order ID',
    'Status',
    'Total',
    'Subtotal', 
    'Currency',
    'Discount Total',
    'Shipping Total',
    'Payment Method',
    'Customer ID',
    'Customer Email',
    'Customer Name',
    'Billing Country',
    'Billing State',
    'Billing City',
    'Billing Address',
    'Shipping Country',
    'Shipping State', 
    'Shipping City',
    'Shipping Address',
    'Created Date',
    'Updated Date'
  ]

  const rows = orders.map(order => [
    order.id,
    order.status,
    order.total,
    order.subtotal,
    order.currency,
    order.discount_total,
    order.shipping_total,
    order.payment_method,
    order.customer_id,
    order.billing?.email,
    order.billing?.first_name && order.billing?.last_name 
      ? `${order.billing.first_name} ${order.billing.last_name}` 
      : order.billing?.first_name || order.billing?.last_name || '',
    order.billing?.country,
    order.billing?.state,
    order.billing?.city,
    `${order.billing?.address_1 || ''} ${order.billing?.address_2 || ''}`.trim(),
    order.shipping?.country,
    order.shipping?.state,
    order.shipping?.city,
    `${order.shipping?.address_1 || ''} ${order.shipping?.address_2 || ''}`.trim(),
    order.created_at,
    order.updated_at
  ])

  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')

  return csvContent
}

// Export Orders CSV
app.get('/api/export/orders', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const format = url.searchParams.get('format') || 'csv'
  const limit = Math.min(10000, Math.max(1, Number(url.searchParams.get('limit') ?? '1000')))
  
  // Apply same filters as the filter API
  const filters = {
    status: url.searchParams.getAll('status'),
    min_total: url.searchParams.get('min_total') ? parseFloat(url.searchParams.get('min_total')!) : undefined,
    max_total: url.searchParams.get('max_total') ? parseFloat(url.searchParams.get('max_total')!) : undefined,
    customer_id: url.searchParams.get('customer_id') ? parseInt(url.searchParams.get('customer_id')!) : undefined,
    payment_method: url.searchParams.getAll('payment_method'),
    from_date: url.searchParams.get('from_date') || undefined,
    to_date: url.searchParams.get('to_date') || undefined,
    currency: url.searchParams.get('currency') || undefined,
    country: url.searchParams.get('country') || undefined
  }

  try {
    let query = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    // Apply filters (same logic as filter endpoint)
    if (filters.status.length > 0) query = query.in('status', filters.status)
    if (filters.min_total !== undefined) query = query.gte('total', filters.min_total)
    if (filters.max_total !== undefined) query = query.lte('total', filters.max_total)
    if (filters.customer_id) query = query.eq('customer_id', filters.customer_id)
    if (filters.payment_method.length > 0) query = query.in('payment_method', filters.payment_method)
    if (filters.from_date) query = query.gte('created_at', filters.from_date)
    if (filters.to_date) query = query.lte('created_at', filters.to_date)
    if (filters.currency) query = query.eq('currency', filters.currency)
    if (filters.country) query = query.eq('billing->>country', filters.country)

    const { data: orders, error } = await query
    if (error) throw error

    if (format === 'csv') {
      const csv = generateOrdersCSV(orders || [])
      const filename = `orders_export_${new Date().toISOString().split('T')[0]}.csv`
      
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Access-Control-Allow-Origin': '*'
        }
      })
    } else {
      return c.json({ orders: orders || [], total: orders?.length || 0 })
    }

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Export Customers CSV
app.get('/api/export/customers', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const format = url.searchParams.get('format') || 'csv'
  const limit = Math.min(10000, Math.max(1, Number(url.searchParams.get('limit') ?? '1000')))
  const search = url.searchParams.get('search') || undefined

  try {
    let query = supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (search) {
      query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
    }

    const { data: customers, error } = await query
    if (error) throw error

    if (format === 'csv') {
      const csv = generateCustomersCSV(customers || [])
      const filename = `customers_export_${new Date().toISOString().split('T')[0]}.csv`
      
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Access-Control-Allow-Origin': '*'
        }
      })
    } else {
      return c.json({ customers: customers || [], total: customers?.length || 0 })
    }

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Export Order Items CSV
app.get('/api/export/order-items', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const format = url.searchParams.get('format') || 'csv'
  const limit = Math.min(10000, Math.max(1, Number(url.searchParams.get('limit') ?? '1000')))
  const order_id = url.searchParams.get('order_id') ? parseInt(url.searchParams.get('order_id')!) : undefined

  try {
    let query = supabase
      .from('order_items')
      .select('*')
      .order('order_id', { ascending: false })
      .limit(limit)

    if (order_id) {
      query = query.eq('order_id', order_id)
    }

    const { data: items, error } = await query
    if (error) throw error

    if (format === 'csv') {
      const csv = generateOrderItemsCSV(items || [])
      const filename = `order_items_export_${new Date().toISOString().split('T')[0]}.csv`
      
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Access-Control-Allow-Origin': '*'
        }
      })
    } else {
      return c.json({ order_items: items || [], total: items?.length || 0 })
    }

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Export All Data (Combined)
app.get('/api/export/all', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const format = url.searchParams.get('format') || 'json'
  const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit') ?? '1000')))

  try {
    // Get all data with limits
    const [ordersResult, customersResult, itemsResult] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(limit),
      supabase.from('customers').select('*').order('created_at', { ascending: false }).limit(limit),
      supabase.from('order_items').select('*').order('order_id', { ascending: false }).limit(limit * 2) // More items expected
    ])

    if (ordersResult.error) throw ordersResult.error
    if (customersResult.error) throw customersResult.error
    if (itemsResult.error) throw itemsResult.error

    const orders = ordersResult.data || []
    const customers = customersResult.data || []
    const items = itemsResult.data || []

    if (format === 'xlsx') {
      // Create Excel workbook with multiple sheets
      const workbook = {
        SheetNames: ['Orders', 'Customers', 'Order Items', 'Summary'],
        Sheets: {} as any
      }

      // Orders sheet
      const ordersData = [
        ['Order ID', 'Status', 'Total', 'Subtotal', 'Currency', 'Discount Total', 'Shipping Total', 'Payment Method', 'Customer ID', 'Customer Email', 'Customer Name', 'Billing Country', 'Billing State', 'Billing City', 'Billing Address', 'Shipping Country', 'Shipping State', 'Shipping City', 'Shipping Address', 'Created Date', 'Updated Date'],
        ...orders.map(order => [
          order.id,
          order.status,
          order.total,
          order.subtotal,
          order.currency,
          order.discount_total,
          order.shipping_total,
          order.payment_method,
          order.customer_id,
          order.billing?.email,
          order.billing?.first_name && order.billing?.last_name 
            ? `${order.billing.first_name} ${order.billing.last_name}` 
            : order.billing?.first_name || order.billing?.last_name || '',
          order.billing?.country,
          order.billing?.state,
          order.billing?.city,
          `${order.billing?.address_1 || ''} ${order.billing?.address_2 || ''}`.trim(),
          order.shipping?.country,
          order.shipping?.state,
          order.shipping?.city,
          `${order.shipping?.address_1 || ''} ${order.shipping?.address_2 || ''}`.trim(),
          order.created_at,
          order.updated_at
        ])
      ]

      // Customers sheet
      const customersData = [
        ['Customer ID', 'Email', 'First Name', 'Last Name', 'Username', 'Billing Country', 'Billing State', 'Billing City', 'Billing Address', 'Shipping Country', 'Shipping State', 'Shipping City', 'Shipping Address', 'Created Date', 'Updated Date'],
        ...customers.map(customer => [
          customer.id,
          customer.email,
          customer.first_name,
          customer.last_name,
          customer.username,
          customer.billing?.country,
          customer.billing?.state,
          customer.billing?.city,
          `${customer.billing?.address_1 || ''} ${customer.billing?.address_2 || ''}`.trim(),
          customer.shipping?.country,
          customer.shipping?.state,
          customer.shipping?.city,
          `${customer.shipping?.address_1 || ''} ${customer.shipping?.address_2 || ''}`.trim(),
          customer.created_at,
          customer.updated_at
        ])
      ]

      // Order Items sheet
      const itemsData = [
        ['Item ID', 'Order ID', 'Product ID', 'Variation ID', 'Product Name', 'Quantity', 'Price', 'Subtotal', 'Total', 'Meta Data'],
        ...items.map(item => [
          item.id,
          item.order_id,
          item.product_id,
          item.variation_id,
          item.name,
          item.quantity,
          item.price,
          item.subtotal,
          item.total,
          item.meta ? JSON.stringify(item.meta) : ''
        ])
      ]

      // Summary sheet
      const totalRevenue = orders.reduce((sum, order) => sum + (order.total || 0), 0)
      const averageOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0
      const statusBreakdown = orders.reduce((acc, order) => {
        const status = order.status || 'unknown'
        acc[status] = (acc[status] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      const summaryData = [
        ['Metric', 'Value'],
        ['Export Date', new Date().toISOString()],
        ['Total Orders', orders.length],
        ['Total Customers', customers.length],
        ['Total Order Items', items.length],
        ['Total Revenue', totalRevenue.toFixed(2)],
        ['Average Order Value', averageOrderValue.toFixed(2)],
        [''],
        ['Order Status Breakdown', ''],
        ...Object.entries(statusBreakdown).map(([status, count]) => [status, count])
      ]

      // Convert arrays to worksheet format (simple implementation)
      const arrayToWorksheet = (data: any[][]) => {
        const ws: any = {}
        const range = { s: { c: 0, r: 0 }, e: { c: 0, r: 0 } }

        for (let R = 0; R < data.length; ++R) {
          for (let C = 0; C < data[R].length; ++C) {
            if (range.s.r > R) range.s.r = R
            if (range.s.c > C) range.s.c = C
            if (range.e.r < R) range.e.r = R
            if (range.e.c < C) range.e.c = C

            const cellRef = String.fromCharCode(65 + C) + (R + 1)
            const cellValue = data[R][C]
            
            if (cellValue !== null && cellValue !== undefined) {
              ws[cellRef] = { v: cellValue, t: typeof cellValue === 'number' ? 'n' : 's' }
            }
          }
        }

        if (range.s.c < 10000000) ws['!ref'] = 
          String.fromCharCode(65 + range.s.c) + (range.s.r + 1) + ':' +
          String.fromCharCode(65 + range.e.c) + (range.e.r + 1)

        return ws
      }

      workbook.Sheets['Orders'] = arrayToWorksheet(ordersData)
      workbook.Sheets['Customers'] = arrayToWorksheet(customersData)
      workbook.Sheets['Order Items'] = arrayToWorksheet(itemsData)
      workbook.Sheets['Summary'] = arrayToWorksheet(summaryData)

      // Simple XLSX generation (note: this is a basic implementation)
      // For production, you might want to use a proper XLSX library
      const xlsxData = JSON.stringify(workbook)
      const filename = `woocommerce_data_${new Date().toISOString().split('T')[0]}.json`
      
      return new Response(xlsxData, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Access-Control-Allow-Origin': '*'
        }
      })
    }

    if (format === 'csv-zip') {
      // Alternative: Create multiple CSV files info for a ZIP download guide
      return c.json({
        message: "For CSV format, use individual endpoints:",
        endpoints: {
          orders: "/api/export/orders?format=csv",
          customers: "/api/export/customers?format=csv", 
          order_items: "/api/export/order-items?format=csv"
        },
        tip: "Download each CSV separately or use format=xlsx for combined Excel file"
      })
    }

    if (format === 'json') {
      return c.json({
        export_date: new Date().toISOString(),
        summary: {
          orders_count: orders.length,
          customers_count: customers.length,
          order_items_count: items.length,
          total_revenue: orders.reduce((sum, order) => sum + (order.total || 0), 0),
          average_order_value: orders.length > 0 ? orders.reduce((sum, order) => sum + (order.total || 0), 0) / orders.length : 0
        },
        data: {
          orders,
          customers,
          order_items: items
        }
      })
    }

    return c.json({ 
      error: 'Unsupported format. Use: json, xlsx, or csv-zip',
      supported_formats: ['json', 'xlsx', 'csv-zip']
    }, 400)

  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

function generateCustomersCSV(customers: any[]): string {
  const headers = [
    'Customer ID',
    'Email',
    'First Name',
    'Last Name',
    'Username',
    'Billing Country',
    'Billing State',
    'Billing City',
    'Billing Address',
    'Shipping Country',
    'Shipping State',
    'Shipping City', 
    'Shipping Address',
    'Created Date',
    'Updated Date'
  ]

  const rows = customers.map(customer => [
    customer.id,
    customer.email,
    customer.first_name,
    customer.last_name,
    customer.username,
    customer.billing?.country,
    customer.billing?.state,
    customer.billing?.city,
    `${customer.billing?.address_1 || ''} ${customer.billing?.address_2 || ''}`.trim(),
    customer.shipping?.country,
    customer.shipping?.state,
    customer.shipping?.city,
    `${customer.shipping?.address_1 || ''} ${customer.shipping?.address_2 || ''}`.trim(),
    customer.created_at,
    customer.updated_at
  ])

  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')

  return csvContent
}

function generateOrderItemsCSV(items: any[]): string {
  const headers = [
    'Item ID',
    'Order ID',
    'Product ID',
    'Variation ID',
    'Product Name',
    'Quantity',
    'Price',
    'Subtotal',
    'Total',
    'Meta Data'
  ]

  const rows = items.map(item => [
    item.id,
    item.order_id,
    item.product_id,
    item.variation_id,
    item.name,
    item.quantity,
    item.price,
    item.subtotal,
    item.total,
    item.meta ? JSON.stringify(item.meta) : ''
  ])

  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')

  return csvContent
}

// Get single order with items
app.get('/api/orders/:id', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'Invalid order ID' }, 400)

  try {
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single()

    if (orderError) throw orderError
    if (!order) return c.json({ error: 'Order not found' }, 404)

    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', id)
      .order('id')

    if (itemsError) throw itemsError

    return c.json({
      ...order,
      items: items || []
    })
  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Get customers with pagination
app.get('/api/customers', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20')))
  const cursor = url.searchParams.get('cursor') || undefined // cursor = customer ID
  const search = url.searchParams.get('search') || undefined
  const sort_direction = url.searchParams.get('sort') === 'asc' ? 'asc' : 'desc'
  
  // Support legacy pagination
  const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined
  const useLegacyPagination = page && !cursor

  try {
    let query = supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: sort_direction === 'asc' })
      .order('id', { ascending: sort_direction === 'asc' })
      .limit(limit + 1)

    // Apply search filter
    if (search) {
      query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
    }

    // Apply cursor-based pagination
    if (cursor && !useLegacyPagination) {
      if (sort_direction === 'desc') {
        query = query.lt('id', Number(cursor))
      } else {
        query = query.gt('id', Number(cursor))
      }
    }

    // Legacy pagination
    if (useLegacyPagination) {
      const offset = Math.max(0, (page - 1) * limit)
      query = query.range(offset, offset + limit - 1)
    }

    const { data, error } = await query
    if (error) throw error

    let customers = data || []
    let hasNext = false
    let nextCursor = null

    if (!useLegacyPagination) {
      if (customers.length > limit) {
        hasNext = true
        customers = customers.slice(0, limit)
      }

      if (customers.length > 0) {
        nextCursor = customers[customers.length - 1].id
      }
    }

    // Legacy pagination count
    let totalCount = 0
    let totalPages = 0
    if (useLegacyPagination) {
      let countQuery = supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })

      if (search) {
        countQuery = countQuery.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
      }

      const { count, error: countError } = await countQuery
      if (countError) throw countError

      totalCount = count || 0
      totalPages = Math.ceil(totalCount / limit)
    }

    const response: any = {
      customers,
      pagination: useLegacyPagination ? {
        type: 'offset',
        page: page,
        limit,
        total: totalCount,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1
      } : {
        type: 'cursor',
        limit,
        has_next: hasNext,
        next_cursor: hasNext ? nextCursor : null,
        sort_direction
      }
    }

    return c.json(response)
  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Get single customer with their orders
app.get('/api/customers/:id', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const id = Number(c.req.param('id'))
  if (!id) return c.json({ error: 'Invalid customer ID' }, 400)

  try {
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single()

    if (customerError) throw customerError
    if (!customer) return c.json({ error: 'Customer not found' }, 404)

    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', id)
      .order('created_at', { ascending: false })

    if (ordersError) throw ordersError

    return c.json({
      ...customer,
      orders: orders || [],
      order_count: orders?.length || 0,
      total_spent: orders?.reduce((sum, order) => sum + (order.total || 0), 0) || 0
    })
  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

// Get order statistics
app.get('/api/stats', async c => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const url = new URL(c.req.url)
  const from_date = url.searchParams.get('from_date') || undefined
  const to_date = url.searchParams.get('to_date') || undefined

  try {
    let ordersQuery = supabase.from('orders').select('status, total, created_at')
    
    if (from_date) ordersQuery = ordersQuery.gte('created_at', from_date)
    if (to_date) ordersQuery = ordersQuery.lte('created_at', to_date)

    const { data: orders, error: ordersError } = await ordersQuery
    if (ordersError) throw ordersError

    const { count: totalCustomers, error: customersError } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
    if (customersError) throw customersError

    const stats = {
      total_orders: orders?.length || 0,
      total_customers: totalCustomers || 0,
      total_revenue: orders?.reduce((sum, order) => sum + (order.total || 0), 0) || 0,
      average_order_value: 0,
      orders_by_status: {} as Record<string, number>
    }

    if (stats.total_orders > 0) {
      stats.average_order_value = stats.total_revenue / stats.total_orders
      
      orders?.forEach(order => {
        const status = order.status || 'unknown'
        stats.orders_by_status[status] = (stats.orders_by_status[status] || 0) + 1
      })
    }

    return c.json(stats)
  } catch (e: any) {
    return c.json({ error: e?.message ?? String(e) }, 500)
  }
})

/** ----- Webhook ----- */

app.post('/woocommerce/webhook', async c => {
  const raw = await c.req.arrayBuffer()
  const topic = c.req.header('x-wc-webhook-topic') || ''

  // Decode the body to see what we received
  const bodyText = new TextDecoder().decode(raw)

  // Enhanced debug logging
  console.log('=== WEBHOOK RECEIVED ===')
  console.log('topic:', topic)
  console.log('body_length:', raw.byteLength)
  console.log('body_text:', bodyText)
  console.log('content-type:', c.req.header('content-type') || 'none')
  console.log('=====================')

  // Handle form-encoded test pings (like webhook_id=1)
  if (bodyText.startsWith('webhook_id=')) {
    console.log('Received WooCommerce test ping')
    return c.json({ ok: true, message: 'Test ping received successfully' })
  }

  // Handle empty or very small bodies
  if (raw.byteLength <= 20 && !bodyText.trim()) {
    console.log('Received empty body - treating as health check')
    return c.json({ ok: true, message: 'Health check received' })
  }

  // Parse JSON
  let body: any
  try {
    body = JSON.parse(bodyText)
  } catch (e) {
    console.error('JSON parse error:', e)
    console.log('Raw body that failed to parse:', bodyText)
    return c.text('Invalid JSON - expected order data', 400)
  }

  const events = Array.isArray(body) ? body : [body]

  for (const event of events) {
    const id = Number(event?.id)

    if (topic === 'order.deleted' && id) {
      const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false }
      })
      
      // Get order data before deletion for Discord notification
      const { data: orderToDelete } = await supabase
        .from('orders')
        .select('*')
        .eq('id', id)
        .single()

      await supabase.from('order_items').delete().eq('order_id', id)
      await supabase.from('orders').delete().eq('id', id)
      
      // Send Discord notification for deletion
      if (orderToDelete) {
        await sendDiscordNotification(c.env, orderToDelete, 'deleted')
      }
      
      continue
    }

    if ((topic === 'order.created' || topic === 'order.updated') && id) {
      let orderData = null
      
      try {
        const full = await fetchWooOrderById(c.env, id)
        await upsertOrderBundle(c.env, full)
        orderData = full
      } catch (e) {
        console.error('REST fetch failed, upserting webhook payload', e)
        try {
          await upsertOrderBundle(c.env, event)
          orderData = event
        } catch (e2) {
          console.error('Payload upsert failed', e2)
        }
      }
      
      // Send Discord notification for create/update
      if (orderData) {
        const eventType = topic === 'order.created' ? 'created' : 'updated'
        await sendDiscordNotification(c.env, orderData, eventType)
      }
    }
  }

  return c.json({ ok: true })
})

export default app