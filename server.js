const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ==================== INICIALIZACIÓN DE BASE DE DATOS ====================
async function initDB() {
    try {
        await pool.query(`
            -- Tabla de Usuarios
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                uuid UUID DEFAULT gen_random_uuid() UNIQUE,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                balance_usdt DECIMAL(18,2) DEFAULT 1000.00,
                balance_locked DECIMAL(18,2) DEFAULT 0.00,
                kyc_status TEXT DEFAULT 'NO VERIFICADO',
                reputation DECIMAL(3,2) DEFAULT 0.00,
                total_trades INTEGER DEFAULT 0,
                is_banned BOOLEAN DEFAULT false,
                country TEXT DEFAULT 'Venezuela',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Tabla de Países y Configuración
            CREATE TABLE IF NOT EXISTS countries (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                currency_code TEXT NOT NULL,
                reference_price DECIMAL(18,2) DEFAULT 36.50,
                is_active BOOLEAN DEFAULT true
            );

            -- Tabla de Bancos por País
            CREATE TABLE IF NOT EXISTS banks (
                id SERIAL PRIMARY KEY,
                country_id INTEGER REFERENCES countries(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                UNIQUE(country_id, name)
            );

            -- Tabla de Órdenes P2P
            CREATE TABLE IF NOT EXISTS orders (
                order_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                buyer_id INTEGER,
                amount_usdt DECIMAL(18,2) NOT NULL,
                price_total DECIMAL(18,2) NOT NULL,
                price_unit DECIMAL(18,6),
                bank_id INTEGER REFERENCES banks(id),
                bank_name TEXT,
                country_id INTEGER REFERENCES countries(id),
                currency_code TEXT,
                order_type TEXT CHECK (order_type IN ('VENTA', 'COMPRA')),
                status TEXT DEFAULT 'ABIERTA' CHECK (status IN ('ABIERTA', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA', 'DISPUTA')),
                min_limit DECIMAL(18,2),
                max_limit DECIMAL(18,2),
                terms TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP
            );

            -- Tabla de Garantía (Escrow)
            CREATE TABLE IF NOT EXISTS escrow (
                id SERIAL PRIMARY KEY,
                order_id UUID REFERENCES orders(order_id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id),
                amount_locked DECIMAL(18,2) NOT NULL,
                status TEXT DEFAULT 'LOCKED' CHECK (status IN ('LOCKED', 'RELEASED', 'RETURNED')),
                locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                released_at TIMESTAMP
            );

            -- Tabla de Mensajes de Chat (Persistente)
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                order_id UUID REFERENCES orders(order_id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                sender_username TEXT,
                text TEXT NOT NULL,
                is_system BOOLEAN DEFAULT false,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Tabla de Soporte Técnico
            CREATE TABLE IF NOT EXISTS support_tickets (
                ticket_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                username TEXT,
                status TEXT DEFAULT 'ABIERTO' CHECK (status IN ('ABIERTO', 'EN_REVISION', 'CERRADO')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP
            );

            -- Tabla de Mensajes de Soporte
            CREATE TABLE IF NOT EXISTS support_messages (
                id SERIAL PRIMARY KEY,
                ticket_id UUID REFERENCES support_tickets(ticket_id) ON DELETE CASCADE,
                sender_id INTEGER REFERENCES users(id),
                sender_username TEXT,
                is_admin BOOLEAN DEFAULT false,
                text TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Tabla de Transacciones (Historial)
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                order_id UUID REFERENCES orders(order_id),
                type TEXT CHECK (type IN ('DEPOSIT', 'WITHDRAWAL', 'TRADE_BUY', 'TRADE_SELL', 'ESCROW_LOCK', 'ESCROW_RELEASE')),
                amount DECIMAL(18,2),
                balance_before DECIMAL(18,2),
                balance_after DECIMAL(18,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Insertar datos iniciales si no existen
            INSERT INTO countries (name, currency_code, reference_price) VALUES
                ('Venezuela', 'VES', 36.50),
                ('Colombia', 'COP', 4200.00),
                ('Argentina', 'ARS', 1050.00),
                ('México', 'MXN', 18.50),
                ('Perú', 'PEN', 3.75)
            ON CONFLICT (name) DO NOTHING;

            -- Insertar bancos de Venezuela
            INSERT INTO banks (country_id, name) VALUES
                ((SELECT id FROM countries WHERE name = 'Venezuela'), 'Banesco'),
                ((SELECT id FROM countries WHERE name = 'Venezuela'), 'Mercantil'),
                ((SELECT id FROM countries WHERE name = 'Venezuela'), 'BBVA Provincial'),
                ((SELECT id FROM countries WHERE name = 'Venezuela'), 'Banco de Venezuela'),
                ((SELECT id FROM countries WHERE name = 'Venezuela'), 'Pago Móvil')
            ON CONFLICT DO NOTHING;

            -- Insertar bancos de Colombia
            INSERT INTO banks (country_id, name) VALUES
                ((SELECT id FROM countries WHERE name = 'Colombia'), 'Bancolombia'),
                ((SELECT id FROM countries WHERE name = 'Colombia'), 'Davivienda'),
                ((SELECT id FROM countries WHERE name = 'Colombia'), 'Nequi'),
                ((SELECT id FROM countries WHERE name = 'Colombia'), 'BBVA Colombia')
            ON CONFLICT DO NOTHING;

            -- Crear usuario admin si no existe
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin') THEN
                    INSERT INTO users (username, email, password_hash, balance_usdt, kyc_status, reputation)
                    VALUES ('admin', 'admin@platinumelite.com', '$2a$10$abcdefghijklmnopqrstuv', 999999.00, 'ADMIN', 5.00);
                END IF;
            END $$;
        `);
        console.log('✅ Base de datos inicializada correctamente');
    } catch (err) {
        console.error('❌ Error inicializando DB:', err);
    }
}

// ==================== RUTAS DE AUTENTICACIÓN ====================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password, country } = req.body;
        
        const existingUser = await pool.query(
            "SELECT * FROM users WHERE email = $1 OR username = $2",
            [email.toLowerCase(), username.toLowerCase()]
        );

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: "Usuario o email ya existe" });
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, country) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [username.toLowerCase(), email.toLowerCase(), hash, country || 'Venezuela']
        );

        res.json({ success: true, user: sanitizeUser(result.rows[0]) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        
        if (result.rows.length === 0) {
            // Auto-registro para simplificar demo
            const hash = await bcrypt.hash(password, 10);
            const newUser = await pool.query(
                `INSERT INTO users (username, email, password_hash) 
                 VALUES ($1, $2, $3) RETURNING *`,
                [email.split('@')[0], email.toLowerCase(), hash]
            );
            return res.json({ success: true, user: sanitizeUser(newUser.rows[0]) });
        }

        const user = result.rows[0];
        
        if (user.is_banned) {
            return res.status(403).json({ error: "Usuario suspendido" });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: "Contraseña incorrecta" });
        }

        res.json({ success: true, user: sanitizeUser(user) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==================== RUTAS DE MERCADO ====================

app.get('/api/countries', async (req, res) => {
    const result = await pool.query(
        "SELECT * FROM countries WHERE is_active = true ORDER BY name"
    );
    res.json(result.rows);
});

app.get('/api/banks/:countryId', async (req, res) => {
    const result = await pool.query(
        "SELECT * FROM banks WHERE country_id = $1 AND is_active = true ORDER BY name",
        [req.params.countryId]
    );
    res.json(result.rows);
});

app.get('/api/ordenes', async (req, res) => {
    const { country, bank, type } = req.query;
    
    let query = `
        SELECT o.*, u.username as seller_username, u.reputation as seller_reputation,
               c.currency_code, b.name as bank_name, c.name as country_name
        FROM orders o
        JOIN users u ON o.seller_id = u.id
        LEFT JOIN countries c ON o.country_id = c.id
        LEFT JOIN banks b ON o.bank_id = b.id
        WHERE o.status = 'ABIERTA' AND u.is_banned = false
    `;
    
    const params = [];
    let paramCount = 1;

    if (country) {
        query += ` AND o.country_id = $${paramCount}`;
        params.push(country);
        paramCount++;
    }

    if (bank) {
        query += ` AND o.bank_id = $${paramCount}`;
        params.push(bank);
        paramCount++;
    }

    if (type) {
        query += ` AND o.order_type = $${paramCount}`;
        params.push(type);
        paramCount++;
    }

    query += " ORDER BY o.created_at DESC";

    const result = await pool.query(query, params);
    res.json(result.rows);
});

app.post('/api/crear-orden', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { seller_id, amount, price_total, bank_id, country_id, order_type, min_limit, max_limit, terms } = req.body;

        // Verificar saldo disponible
        const userResult = await client.query("SELECT balance_usdt FROM users WHERE id = $1", [seller_id]);
        const user = userResult.rows[0];

        if (order_type === 'VENTA' && user.balance_usdt < parseFloat(amount)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Saldo insuficiente" });
        }

        // Obtener información del banco y país
        const bankResult = await client.query("SELECT name, country_id FROM banks WHERE id = $1", [bank_id]);
        const countryResult = await client.query("SELECT currency_code FROM countries WHERE id = $1", [country_id]);

        const price_unit = parseFloat(price_total) / parseFloat(amount);

        // Crear orden
        const orderResult = await client.query(
            `INSERT INTO orders (seller_id, amount_usdt, price_total, price_unit, bank_id, bank_name, 
                                country_id, currency_code, order_type, min_limit, max_limit, terms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [seller_id, amount, price_total, price_unit, bank_id, bankResult.rows[0].name,
             country_id, countryResult.rows[0].currency_code, order_type, 
             min_limit || amount, max_limit || amount, terms || '']
        );

        // Si es orden de venta, bloquear fondos en escrow
        if (order_type === 'VENTA') {
            await client.query(
                "UPDATE users SET balance_usdt = balance_usdt - $1, balance_locked = balance_locked + $1 WHERE id = $2",
                [amount, seller_id]
            );

            await client.query(
                "INSERT INTO escrow (order_id, user_id, amount_locked) VALUES ($1, $2, $3)",
                [orderResult.rows[0].order_id, seller_id, amount]
            );

            await client.query(
                `INSERT INTO transactions (user_id, order_id, type, amount, balance_before, balance_after)
                 VALUES ($1, $2, 'ESCROW_LOCK', $3, $4, $5)`,
                [seller_id, orderResult.rows[0].order_id, amount, user.balance_usdt, user.balance_usdt - parseFloat(amount)]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true, order: orderResult.rows[0] });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

app.post('/api/tomar-orden', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { order_id, buyer_id } = req.body;

        const orderResult = await client.query("SELECT * FROM orders WHERE order_id = $1", [order_id]);
        const order = orderResult.rows[0];

        if (order.status !== 'ABIERTA') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Orden no disponible" });
        }

        await client.query(
            "UPDATE orders SET status = 'EN_PROCESO', buyer_id = $1 WHERE order_id = $2",
            [buyer_id, order_id]
        );

        // Mensaje del sistema
        await client.query(
            `INSERT INTO messages (order_id, sender_id, sender_username, text, is_system)
             VALUES ($1, $2, 'SISTEMA', 'Orden iniciada. Por favor, coordinen el pago.', true)`,
            [order_id, buyer_id]
        );

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

app.post('/api/liberar-fondos', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { order_id, user_id } = req.body;

        const orderResult = await client.query(
            `SELECT o.*, u.username FROM orders o 
             JOIN users u ON o.seller_id = u.id 
             WHERE o.order_id = $1`,
            [order_id]
        );
        const order = orderResult.rows[0];

        // Solo el vendedor o admin puede liberar
        const userResult = await client.query("SELECT username FROM users WHERE id = $1", [user_id]);
        const isAdmin = userResult.rows[0].username === 'admin';
        
        if (order.seller_id !== user_id && !isAdmin) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "No autorizado" });
        }

        if (order.status !== 'EN_PROCESO') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Orden no está en proceso" });
        }

        // Liberar escrow al comprador
        await client.query(
            "UPDATE escrow SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP WHERE order_id = $1",
            [order_id]
        );

        await client.query(
            "UPDATE users SET balance_usdt = balance_usdt + $1, balance_locked = balance_locked - $1 WHERE id = $2",
            [order.amount_usdt, order.buyer_id]
        );

        await client.query(
            "UPDATE orders SET status = 'COMPLETADA', completed_at = CURRENT_TIMESTAMP WHERE order_id = $1",
            [order_id]
        );

        // Actualizar reputación
        await client.query(
            `UPDATE users SET 
             total_trades = total_trades + 1,
             reputation = LEAST(5.00, reputation + 0.1)
             WHERE id IN ($1, $2)`,
            [order.seller_id, order.buyer_id]
        );

        await client.query(
            `INSERT INTO messages (order_id, sender_id, sender_username, text, is_system)
             VALUES ($1, $2, 'SISTEMA', '✅ Orden completada exitosamente. Fondos liberados.', true)`,
            [order_id, user_id]
        );

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

app.post('/api/cancelar-orden', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { order_id, user_id } = req.body;

        const orderResult = await client.query("SELECT * FROM orders WHERE order_id = $1", [order_id]);
        const order = orderResult.rows[0];

        const userResult = await client.query("SELECT username FROM users WHERE id = $1", [user_id]);
        const isAdmin = userResult.rows[0].username === 'admin';

        if (order.seller_id !== user_id && order.buyer_id !== user_id && !isAdmin) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: "No autorizado" });
        }

        // Devolver fondos del escrow si existía
        if (order.order_type === 'VENTA' && order.status === 'ABIERTA') {
            await client.query(
                "UPDATE users SET balance_usdt = balance_usdt + $1, balance_locked = balance_locked - $1 WHERE id = $2",
                [order.amount_usdt, order.seller_id]
            );

            await client.query(
                "UPDATE escrow SET status = 'RETURNED' WHERE order_id = $1",
                [order_id]
            );
        }

        await client.query(
            "UPDATE orders SET status = 'CANCELADA' WHERE order_id = $1",
            [order_id]
        );

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

// ==================== RUTAS DE CHAT ====================

app.get('/api/mensajes/:order_id', async (req, res) => {
    const result = await pool.query(
        `SELECT * FROM messages WHERE order_id = $1 ORDER BY timestamp ASC`,
        [req.params.order_id]
    );
    res.json(result.rows);
});

// ==================== RUTAS DE SOPORTE ====================

app.post('/api/soporte/crear', async (req, res) => {
    const { user_id, username } = req.body;
    const result = await pool.query(
        `INSERT INTO support_tickets (user_id, username) VALUES ($1, $2) RETURNING *`,
        [user_id, username]
    );
    res.json({ success: true, ticket: result.rows[0] });
});

app.get('/api/soporte/tickets', async (req, res) => {
    const result = await pool.query(
        `SELECT * FROM support_tickets ORDER BY created_at DESC`
    );
    res.json(result.rows);
});

app.get('/api/soporte/mensajes/:ticket_id', async (req, res) => {
    const result = await pool.query(
        `SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY timestamp ASC`,
        [req.params.ticket_id]
    );
    res.json(result.rows);
});

// ==================== RUTAS DE ADMINISTRADOR ====================

app.get('/api/admin/usuarios', async (req, res) => {
    const result = await pool.query(
        `SELECT id, uuid, username, email, balance_usdt, balance_locked, 
                reputation, total_trades, is_banned, country, created_at
         FROM users ORDER BY created_at DESC`
    );
    res.json(result.rows);
});

app.post('/api/admin/ban-user', async (req, res) => {
    const { user_id, banned } = req.body;
    await pool.query(
        "UPDATE users SET is_banned = $1 WHERE id = $2",
        [banned, user_id]
    );
    res.json({ success: true });
});

app.post('/api/admin/ajustar-saldo', async (req, res) => {
    const { user_id, amount } = req.body;
    await pool.query(
        "UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2",
        [amount, user_id]
    );
    res.json({ success: true });
});

app.post('/api/admin/ajustar-reputacion', async (req, res) => {
    const { user_id, reputation } = req.body;
    await pool.query(
        "UPDATE users SET reputation = $1 WHERE id = $2",
        [reputation, user_id]
    );
    res.json({ success: true });
});

app.get('/api/admin/ordenes', async (req, res) => {
    const result = await pool.query(
        `SELECT o.*, 
                u1.username as seller_username,
                u2.username as buyer_username
         FROM orders o
         LEFT JOIN users u1 ON o.seller_id = u1.id
         LEFT JOIN users u2 ON o.buyer_id = u2.id
         ORDER BY o.created_at DESC`
    );
    res.json(result.rows);
});

// ==================== SOCKET.IO ====================

io.on('connection', (socket) => {
    console.log('🔌 Usuario conectado:', socket.id);

    // Chat de órdenes P2P
    socket.on('unirse_p2p', async (order_id) => {
        socket.join(order_id);
        
        // Enviar historial de mensajes
        const result = await pool.query(
            `SELECT * FROM messages WHERE order_id = $1 ORDER BY timestamp ASC`,
            [order_id]
        );
        socket.emit('historial_chat', result.rows);
    });

    socket.on('msg_p2p', async (data) => {
        const { order_id, sender_id, username, text } = data;
        
        const result = await pool.query(
            `INSERT INTO messages (order_id, sender_id, sender_username, text) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [order_id, sender_id, username, text]
        );

        io.to(order_id).emit('update_chat', result.rows[0]);
    });

    // Chat de soporte
    socket.on('unirse_soporte', async (ticket_id) => {
        socket.join(`support_${ticket_id}`);
        
        const result = await pool.query(
            `SELECT * FROM support_messages WHERE ticket_id = $1 ORDER BY timestamp ASC`,
            [ticket_id]
        );
        socket.emit('historial_soporte', result.rows);
    });

    socket.on('msg_soporte', async (data) => {
        const { ticket_id, sender_id, username, text, is_admin } = data;
        
        const result = await pool.query(
            `INSERT INTO support_messages (ticket_id, sender_id, sender_username, text, is_admin) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [ticket_id, sender_id, username, text, is_admin || false]
        );

        io.to(`support_${ticket_id}`).emit('update_soporte', result.rows[0]);
    });

    socket.on('disconnect', () => {
        console.log('❌ Usuario desconectado:', socket.id);
    });
});

// ==================== UTILIDADES ====================

function sanitizeUser(user) {
    const { password_hash, ...safeUser } = user;
    return safeUser;
}

// ==================== SERVIDOR ====================

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

initDB().then(() => {
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Platinum Elite P2P Server running on port ${PORT}`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
});
