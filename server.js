require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// --- 1. CONFIGURACIÓN ESTRUCTURAL ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 5e7 // 50MB para comprobantes
});

// Seguridad y Middlewares
app.use(helmet({ contentSecurityPolicy: false })); // Permite cargar recursos externos si es necesario
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
app.use(limiter);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Directorio de subidas
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const BANCOS_VZLA = ["PAGO_MOVIL", "BANESCO", "MERCANTIL", "PROVINCIAL", "VENEZUELA", "BNC", "BANCAMIGA"];

// --- 2. INICIALIZACIÓN DE BASE DE DATOS (ESQUEMA COMPLETO) ---
const initDB = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Usuarios y Billeteras
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                kyc_level INTEGER DEFAULT 0,
                reputation_score DECIMAL(5,2) DEFAULT 100.00,
                is_admin BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS wallets (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                balance_available DECIMAL(20,8) DEFAULT 0.00,
                balance_locked DECIMAL(20,8) DEFAULT 0.00
            );
            CREATE TABLE IF NOT EXISTS payment_methods (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                bank_name TEXT,
                account_number TEXT,
                account_holder TEXT,
                cedula TEXT
            );
            CREATE TABLE IF NOT EXISTS ads (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                type TEXT, -- BUY / SELL
                price DECIMAL(20,2),
                min_limit DECIMAL(20,2),
                max_limit DECIMAL(20,2),
                total_amount DECIMAL(20,8),
                status TEXT DEFAULT 'ACTIVE'
            );
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                ad_id INTEGER REFERENCES ads(id),
                buyer_id INTEGER REFERENCES users(id),
                seller_id INTEGER REFERENCES users(id),
                crypto_amount DECIMAL(20,8),
                fiat_amount DECIMAL(20,2),
                status TEXT DEFAULT 'CREATED', -- CREATED, PAID, COMPLETED, CANCELLED, DISPUTE
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                order_id TEXT REFERENCES orders(id),
                sender_id INTEGER REFERENCES users(id),
                message TEXT,
                image_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        await client.query('COMMIT');
        console.log("💎 PLATINUM ENGINE: Esquema Industrial Cargado.");
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR DB:", e);
    } finally { client.release(); }
};
initDB();

// --- 3. SISTEMA DE SEGURIDAD (JWT) ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET || 'PLATINUM_SECRET_2026', (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- 4. RUTAS DE ADMINISTRADOR (EL "POWER UP") ---
app.get('/admin-power-up', async (req, res) => {
    try {
        const email = 'alonzolaramiguelangel@gmail.com';
        const client = await pool.connect();
        const result = await client.query(`
            UPDATE users SET is_admin = true, kyc_level = 2 WHERE email = $1 RETURNING id`, [email]);
        
        if (result.rowCount > 0) {
            await client.query(`UPDATE wallets SET balance_available = balance_available + 10000 WHERE user_id = $1`, [result.rows[0].id]);
            res.send("<h1 style='color:cyan; background:black; padding:50px;'>🚀 ACCESO DIOS ACTIVADO: +10,000 USDT Y RANGO ADMIN</h1>");
        } else {
            res.status(404).send("Error: Regístrate primero con ese correo.");
        }
        client.release();
    } catch (e) { res.status(500).send(e.message); }
});

// --- 5. RUTAS DE MERCADO Y ÓRDENES ---

// Registro con creación de billetera automática
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const hash = await bcrypt.hash(password, 10);
        const newUser = await client.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
            [username, email, hash]
        );
        await client.query('INSERT INTO wallets (user_id) VALUES ($1)', [newUser.rows[0].id]);
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: "Email o Usuario duplicado" });
    } finally { client.release(); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (user.rows.length > 0 && await bcrypt.compare(password, user.rows[0].password_hash)) {
        const token = jwt.sign({ id: user.rows[0].id, isAdmin: user.rows[0].is_admin }, process.env.JWT_SECRET || 'PLATINUM_SECRET_2026');
        res.json({ token, user: { id: user.rows[0].id, username: user.rows[0].username, is_admin: user.rows[0].is_admin } });
    } else {
        res.status(401).json({ error: "Credenciales incorrectas" });
    }
});

// Obtener Mercado
app.get('/api/ads', async (req, res) => {
    const result = await pool.query(`
        SELECT ads.*, users.username, users.reputation_score 
        FROM ads JOIN users ON ads.user_id = users.id 
        WHERE ads.status = 'ACTIVE' ORDER BY ads.price ASC`);
    res.json(result.rows);
});

// --- 6. MOTOR DE ESCROW (FLUJO REAL) ---

app.post('/api/orders/create', authenticateToken, async (req, res) => {
    const { ad_id, fiat_amount } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ad = (await client.query("SELECT * FROM ads WHERE id = $1 FOR UPDATE", [ad_id])).rows[0];
        const cryptoAmount = fiat_amount / ad.price;
        const orderId = "ORD-" + Math.random().toString(36).toUpperCase().substring(2, 10);

        let buyer_id = req.user.id;
        let seller_id = ad.user_id;

        // Si el anuncio es de VENTA, el creador del anuncio es el vendedor
        if (ad.type === 'SELL') {
            // El saldo ya debería estar bloqueado en el anuncio. 
            // Para simplificar esta versión:
            await client.query("UPDATE ads SET total_amount = total_amount - $1 WHERE id = $2", [cryptoAmount, ad_id]);
        }

        await client.query(
            `INSERT INTO orders (id, ad_id, buyer_id, seller_id, crypto_amount, fiat_amount) VALUES ($1, $2, $3, $4, $5, $6)`,
            [orderId, ad_id, buyer_id, seller_id, cryptoAmount, fiat_amount]
        );

        await client.query('COMMIT');
        res.json({ success: true, orderId });
    } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message });
    } finally { client.release(); }
});

// Liberar Fondos (Solo el Vendedor)
app.post('/api/orders/release', authenticateToken, async (req, res) => {
    const { orderId } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const order = (await client.query("SELECT * FROM orders WHERE id = $1 AND seller_id = $2 FOR UPDATE", [orderId, req.user.id])).rows[0];
        
        if (order.status !== 'PAID') throw new Error("La orden debe estar pagada primero.");

        await client.query("UPDATE wallets SET balance_available = balance_available + $1 WHERE user_id = $2", [order.crypto_amount, order.buyer_id]);
        await client.query("UPDATE orders SET status = 'COMPLETED' WHERE id = $1", [orderId]);
        
        await client.query('COMMIT');
        io.to(`order_${orderId}`).emit('order_update', { status: 'COMPLETED' });
        res.json({ success: true });
    } catch (e) { await client.query('ROLLBACK'); res.status(400).json({ error: e.message });
    } finally { client.release(); }
});

// --- 7. COMUNICACIÓN SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('join_order', (orderId) => socket.join(`order_${orderId}`));
    
    socket.on('send_message', async (data) => {
        const { orderId, senderId, message, imageUrl } = data;
        await pool.query("INSERT INTO chat_messages (order_id, sender_id, message, image_url) VALUES ($1, $2, $3, $4)", 
            [orderId, senderId, message, imageUrl]);
        io.to(`order_${orderId}`).emit('new_message', data);
    });
});

// --- 8. ARRANQUE FINAL ---
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ===========================================
    💎 PLATINUM P2P VENEZUELA - ENGINE V2
    PUERTO: ${PORT} | MODO: INDUSTRIAL
    ===========================================
    `);
});
