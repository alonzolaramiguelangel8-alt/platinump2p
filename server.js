const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- BASE DE DATOS REPARADA Y UNIFICADA ---
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password_hash TEXT,
                balance_usdt DECIMAL(18,2) DEFAULT 1000.00,
                kyc_status TEXT DEFAULT 'NO VERIFICADO'
            );
            CREATE TABLE IF NOT EXISTS orders (
                order_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                buyer_id INTEGER REFERENCES users(id),
                seller_id INTEGER REFERENCES users(id),
                amount_usdt DECIMAL(18,2),
                price_ves DECIMAL(18,2),
                bank TEXT,
                status TEXT DEFAULT 'ABIERTA'
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                order_id UUID REFERENCES orders(order_id),
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Platinum DB: Unificada y Lista");
    } catch (err) { console.error("Error DB:", err.message); }
}
initDB();

// --- RUTAS API ---

// Enviar HTML unificado
app.get('/', (req, res) => res.send(mainHTML));

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        let r = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        
        if (r.rows.length === 0) {
            const hash = await bcrypt.hash(password, 10);
            r = await pool.query("INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING *", 
                [email.split('@')[0], email.toLowerCase(), hash]);
        } else {
            const valid = await bcrypt.compare(password, r.rows[0].password_hash);
            if (!valid) return res.status(401).json({ error: "Clave errada" });
        }
        res.json({ success: true, user: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ordenes', async (req, res) => {
    const r = await pool.query("SELECT * FROM orders WHERE status = 'ABIERTA' ORDER BY price_ves ASC");
    res.json(r.rows);
});

app.post('/api/crear-orden', async (req, res) => {
    const { seller_id, amount, price, bank } = req.body;
    const r = await pool.query("INSERT INTO orders (seller_id, amount_usdt, price_ves, bank, status) VALUES ($1,$2,$3,$4,'ABIERTA') RETURNING order_id", 
        [seller_id, amount, price, bank]);
    res.json({ order_id: r.rows[0].order_id });
});

// --- LÓGICA SOCKET.IO (CHAT REALTIME) ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (order_id) => {
        socket.join(order_id);
    });

    socket.on('msg_p2p', async (data) => {
        const { order_id, sender_id, username, text } = data;
        await pool.query("INSERT INTO messages (order_id, sender_id, text) VALUES ($1,$2,$3)", [order_id, sender_id, text]);
        io.to(order_id).emit('update_chat', { username, text });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Platinum Elite P2P en puerto ${PORT}`));

// --- INTERFAZ INTEGRADA (HTML) ---
const mainHTML = `... (Sigue abajo) ...`;
