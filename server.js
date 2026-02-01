/**
 * PLATINUM P2P VENEZUELA - ULTRA ENGINE (CORREGIDO)
 * Versión: 2.0.1 - Listo para Producción y Testeo
 */

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

// --- 1. CONFIGURACIÓN ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(helmet({ contentSecurityPolicy: false })); // CSP off para facilitar carga de scripts externos en testeo
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public')); // Para servir tus archivos HTML
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Crear carpeta uploads si no existe
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --- 2. MIDDLEWARES ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "No token" });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Token inválido" });
        req.user = user;
        next();
    });
};

// --- 3. RUTAS DE AUTENTICACIÓN (MEJORADAS) ---

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Verificamos si es el primer usuario para hacerlo ADMIN
        const userCount = await client.query("SELECT COUNT(*) FROM users");
        const isFirstUser = parseInt(userCount.rows[0].count) === 0;

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await client.query(
            `INSERT INTO users (username, email, password_hash, is_admin, kyc_level) 
             VALUES ($1, $2, $3, $4, 2) RETURNING id`, // KYC 2 automático al primero para pruebas
            [username, email, hashedPassword, isFirstUser]
        );
        
        await client.query(`INSERT INTO wallets (user_id, balance_available) VALUES ($1, 1000.00)`, [newUser.rows[0].id]); // Regalo de 1000 USDT para test
        
        await client.query('COMMIT');
        res.json({ success: true, message: isFirstUser ? "Admin creado con éxito" : "Usuario registrado" });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: "Email o usuario ya en uso." });
    } finally { client.release(); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (user.rows.length === 0) return res.status(400).json({ error: "Usuario no existe" });

        const validPass = await bcrypt.compare(password, user.rows[0].password_hash);
        if (!validPass) return res.status(400).json({ error: "Clave incorrecta" });

        const token = jwt.sign(
            { id: user.rows[0].id, isAdmin: user.rows[0].is_admin, username: user.rows[0].username }, 
            process.env.JWT_SECRET, 
            { expiresIn: '24h' }
        );
        
        res.json({ token, isAdmin: user.rows[0].is_admin, username: user.rows[0].username });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 4. RUTAS DE DISPUTA (NUEVAS) ---

app.get('/api/admin/disputas', authenticateToken, async (req, res) => {
    if (!req.user.isAdmin) return res.status(403).send("Acceso denegado");
    const result = await pool.query("SELECT * FROM orders WHERE status = 'DISPUTE'");
    res.json(result.rows);
});

app.post('/api/admin/resolve-dispute', authenticateToken, async (req, res) => {
    if (!req.user.isAdmin) return res.status(403).send("Acceso denegado");
    const { orderId, winnerId } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const order = (await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
        
        // Mover fondos del vendedor bloqueados al ganador
        await client.query("UPDATE wallets SET balance_locked = balance_locked - $1 WHERE user_id = $2", [order.crypto_amount, order.seller_id]);
        await client.query("UPDATE wallets SET balance_available = balance_available + $1 WHERE user_id = $2", [order.crypto_amount, winnerId]);
        await client.query("UPDATE orders SET status = 'RESOLVED' WHERE id = $1", [orderId]);

        await client.query('COMMIT');
        io.to(`order_${orderId}`).emit('order_update', { status: 'RESOLVED' });
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
});

// --- 5. SOCKETS Y CHAT ---

io.on('connection', (socket) => {
    socket.on('join_order', (orderId) => socket.join(`order_${orderId}`));

    socket.on('send_message', async (data) => {
        const { orderId, senderId, message } = data;
        await pool.query("INSERT INTO chat_messages (order_id, sender_id, message) VALUES ($1, $2, $3)", [orderId, senderId, message]);
        io.to(`order_${orderId}`).emit('new_message', data);
    });
});

// Ruta base para verificar que el server vive
app.get('/', (req, res) => res.send("🚀 Servidor Platinum P2P Activo y Corriendo"));

// --- 6. ARRANQUE ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ===========================================
    🚀 PLATINUM P2P CARGADO EXITOSAMENTE
    🌍 Puerto: ${PORT}
    🛠️  Modo: Desarrollo / Producción
    🔒 Admin Bypass: Activado para primer registro
    ===========================================
    `);
});
