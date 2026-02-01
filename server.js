const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// --- BASE DE DATOS CON SÚPER REPARACIÓN ---
async function initDB() {
    try {
        // 1. Crear tablas base si no existen
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password_hash TEXT
            );
            CREATE TABLE IF NOT EXISTS orders (
                order_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                buyer_id INTEGER REFERENCES users(id),
                seller_id INTEGER REFERENCES users(id),
                amount_usdt DECIMAL(18,2),
                price_ves DECIMAL(18,2),
                bank TEXT,
                status TEXT DEFAULT 'ESPERANDO_PAGO'
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER REFERENCES users(id),
                text TEXT
            );
        `);

        // 2. REPARACIÓN PROFUNDA: order_id y timestamp
        await pool.query(`
            DO $$ 
            BEGIN 
                -- Reparar order_id
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='order_id') THEN
                    ALTER TABLE messages ADD COLUMN order_id UUID REFERENCES orders(order_id);
                END IF;
                
                -- Reparar timestamp
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='timestamp') THEN
                    ALTER TABLE messages ADD COLUMN timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);
        
        console.log("✅ Base de Datos Reparada: order_id y timestamp listos.");
    } catch (err) { console.error("Error crítico en DB:", err.message); }
}
initDB();

// --- INTERFAZ VISUAL ---
const mainHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Platinum P2P - Fix</title>
    <style>
        :root { --gold: #f3ba2f; --bg: #0b0e11; --card: #1e2329; }
        body { background: var(--bg); color: white; font-family: sans-serif; text-align: center; padding: 50px; }
        .box { background: var(--card); padding: 30px; border-radius: 10px; display: inline-block; width: 300px; }
        input { width: 100%; padding: 10px; margin: 10px 0; border-radius: 5px; border: 1px solid #444; background: #2b3139; color: white; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: var(--gold); border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
    </style>
</head>
<body>
    <div id="authView" class="box">
        <h2 style="color:var(--gold)">PLATINUM P2P</h2>
        <input type="email" id="email" placeholder="Correo">
        <input type="password" id="pass" placeholder="Contraseña">
        <button onclick="login()">INGRESAR / REGISTRAR</button>
    </div>
    <div id="p2pView" style="display:none">
        <h2 style="color:var(--gold)">¡Todo listo!</h2>
        <p>El sistema está reparado y el chat funcionando.</p>
        <button onclick="location.reload()" style="width:200px">Cerrar Sesión</button>
    </div>
    <script>
        async function login() {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ email: email.value, password: pass.value })
            });
            if(res.ok) {
                authView.style.display = 'none';
                p2pView.style.display = 'block';
            } else { alert("Error al conectar"); }
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(mainHTML));

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        let r = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        if (r.rows.length === 0) {
            const hash = await bcrypt.hash(password, 10);
            r = await pool.query("INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING *", [email.split('@')[0], email.toLowerCase(), hash]);
        }
        res.json({ success: true, user: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Rutas de Chat y Orden se mantienen iguales pero con la DB ya reparada
app.post('/api/p2p/order', async (req, res) => {
    const { buyer_id, seller_id, amount, price, bank } = req.body;
    const r = await pool.query("INSERT INTO orders (buyer_id, seller_id, amount_usdt, price_ves, bank) VALUES ($1,$2,$3,$4,$5) RETURNING order_id", [buyer_id, seller_id, amount, price, bank]);
    res.json({ order_id: r.rows[0].order_id });
});

app.get('/api/chat/:id', async (req, res) => {
    const m = await pool.query("SELECT * FROM messages WHERE order_id = $1 ORDER BY timestamp ASC", [req.params.id]);
    const s = await pool.query("SELECT status FROM orders WHERE order_id = $1", [req.params.id]);
    res.json({ msgs: m.rows, status: s.rows[0].status });
});

app.post('/api/chat', async (req, res) => {
    const { order_id, sender_id, text } = req.body;
    await pool.query("INSERT INTO messages (order_id, sender_id, text) VALUES ($1,$2,$3)", [order_id, sender_id, text]);
    res.json({ success: true });
});

app.post('/api/p2p/status', async (req, res) => {
    const { order_id, status } = req.body;
    await pool.query("UPDATE orders SET status = $1 WHERE order_id = $2", [status, order_id]);
    res.json({ success: true });
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 Platinum P2P Reparado"));
