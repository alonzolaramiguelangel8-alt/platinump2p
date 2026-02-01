const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- 1. CONEXIÓN A BASE DE DATOS ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Inicialización de Tablas (Nombres corregidos a order_id)
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password_hash TEXT,
                kyc_status TEXT DEFAULT 'APROBADO'
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
                order_id UUID REFERENCES orders(order_id),
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Base de Datos Sincronizada");
    } catch (err) { console.error("Error DB:", err); }
}
initDB();

// --- 2. INTERFAZ VISUAL (ENVIADA DIRECTAMENTE) ---

const mainHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Platinum P2P - Venezuela</title>
    <style>
        :root { --gold: #f3ba2f; --bg: #0b0e11; --card: #1e2329; --green: #2ebd85; }
        body { background: var(--bg); color: white; font-family: sans-serif; margin: 0; padding: 0; }
        .auth-box { width: 320px; margin: 100px auto; background: var(--card); padding: 30px; border-radius: 10px; text-align: center; }
        .p2p-container { display: none; padding: 20px; }
        input { width: 100%; padding: 12px; margin: 10px 0; border-radius: 5px; border: 1px solid #444; background: #2b3139; color: white; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: var(--gold); border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        .ad-card { background: var(--card); padding: 20px; border-radius: 10px; margin-top: 15px; border-left: 5px solid var(--gold); display: flex; justify-content: space-between; align-items: center; }
        .chat-area { display: none; background: var(--card); padding: 20px; border-radius: 10px; margin-top: 20px; }
        #msgs { height: 200px; overflow-y: auto; background: #000; padding: 10px; margin-bottom: 10px; border-radius: 5px; }
    </style>
</head>
<body>
    <div id="authArea" class="auth-box">
        <h2 style="color:var(--gold)">PLATINUM P2P</h2>
        <input type="text" id="user" placeholder="Usuario">
        <input type="email" id="email" placeholder="Correo">
        <input type="password" id="pass" placeholder="Contraseña">
        <button onclick="auth('register')">REGISTRARSE</button>
        <button onclick="auth('login')" style="background:none; color:var(--gold); border:1px solid var(--gold); margin-top:10px;">INGRESAR</button>
    </div>

    <div id="p2pArea" class="p2p-container">
        <header style="display:flex; justify-content:space-between">
            <h2 style="color:var(--gold)">Mercado P2P (VES)</h2>
            <span id="userName"></span>
        </header>
        
        <div class="ad-card">
            <div>
                <b>Vendedor: Admin_Escrow</b><br>
                Tasa: <span style="font-size:20px; color:var(--gold)">54.80 VES</span><br>
                Bancos: Banesco, Pago Móvil
            </div>
            <button onclick="crearOrden()" style="width:150px; background:var(--green)">COMPRAR</button>
        </div>

        <div id="chatArea" class="chat-area">
            <h3>Orden: <small id="ordId"></small></h3>
            <div id="msgs"></div>
            <div style="display:flex; gap:10px">
                <input type="text" id="txt" placeholder="Escribe al vendedor...">
                <button onclick="enviarMsg()" style="width:100px">Enviar</button>
            </div>
        </div>
    </div>

    <script>
        let currentUser = null;
        let activeOrder = null;

        async function auth(type) {
            const body = { username: user.value, email: email.value, password: pass.value };
            const res = await fetch('/api/auth/' + type, { 
                method: 'POST', 
                headers: {'Content-Type': 'application/json'}, 
                body: JSON.stringify(body) 
            });
            const data = await res.json();
            if(res.ok) {
                if(type === 'login') {
                    currentUser = data.user;
                    authArea.style.display = 'none';
                    p2pArea.style.display = 'block';
                    userName.innerText = currentUser.username;
                } else alert("Registrado. Ahora ingresa.");
            } else alert(data.error);
        }

        async function crearOrden() {
            const res = await fetch('/api/p2p/order', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ buyer_id: currentUser.id, seller_id: 1, amount: 100, price: 54.80, bank: 'Banesco' })
            });
            const data = await res.json();
            activeOrder = data.order_id;
            chatArea.style.display = 'block';
            ordId.innerText = activeOrder;
            setInterval(cargarChat, 2000);
        }

        async function enviarMsg() {
            await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ order_id: activeOrder, sender_id: currentUser.id, text: txt.value })
            });
            txt.value = '';
        }

        async function cargarChat() {
            const res = await fetch('/api/chat/' + activeOrder);
            const data = await res.json();
            msgs.innerHTML = data.map(m => \`<div><b>\${m.sender_id == currentUser.id ? 'Tú' : 'Vendedor'}:</b> \${m.text}</div>\`).join('');
        }
    </script>
</body>
</html>
`;

// --- 3. RUTAS DEL SERVIDOR ---

// Enviar el HTML directamente (Sin usar archivos físicos)
app.get('/', (req, res) => res.send(mainHTML));
app.get('/dashboard', (req, res) => res.send(mainHTML));

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query("INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username", [username.toLowerCase(), email.toLowerCase(), hash]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "Usuario ya existe" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if(valid) res.json({ success: true, user: result.rows[0] });
        else res.status(400).json({ error: "Clave errada" });
    } catch (e) { res.status(400).json({ error: "No existe" }); }
});

app.post('/api/p2p/order', async (req, res) => {
    const { buyer_id, seller_id, amount, price, bank } = req.body;
    const r = await pool.query("INSERT INTO orders (buyer_id, seller_id, amount_usdt, price_ves, bank) VALUES ($1,$2,$3,$4,$5) RETURNING order_id", [buyer_id, seller_id, amount, price, bank]);
    res.json({ order_id: r.rows[0].order_id });
});

app.get('/api/chat/:id', async (req, res) => {
    const r = await pool.query("SELECT * FROM messages WHERE order_id = $1 ORDER BY timestamp ASC", [req.params.id]);
    res.json(r.rows);
});

app.post('/api/chat', async (req, res) => {
    const { order_id, sender_id, text } = req.body;
    await pool.query("INSERT INTO messages (order_id, sender_id, text) VALUES ($1,$2,$3)", [order_id, sender_id, text]);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Platinum P2P Professional Ready`));
