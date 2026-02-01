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

// --- 1. BASE DE DATOS: REPARACIÓN Y ESTRUCTURA ---
async function initDB() {
    try {
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

        // REPARACIÓN AUTOMÁTICA DE COLUMNAS FALTANTES
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='order_id') THEN
                    ALTER TABLE messages ADD COLUMN order_id UUID REFERENCES orders(order_id);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='timestamp') THEN
                    ALTER TABLE messages ADD COLUMN timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
                END IF;
            END $$;
        `);
        console.log("✅ Base de Datos Blindada y Sincronizada");
    } catch (err) { console.error("Error DB:", err.message); }
}
initDB();

// --- 2. INTERFAZ COMPLETA (FILTROS, CHAT Y BOTONES) ---
const mainHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Platinum P2P - VZLA PRO</title>
    <style>
        :root { --gold: #f3ba2f; --bg: #0b0e11; --card: #1e2329; --green: #2ebd85; --red: #f6465d; }
        body { background: var(--bg); color: white; font-family: 'Segoe UI', sans-serif; margin: 0; }
        .nav { background: var(--card); padding: 15px 5%; display: flex; justify-content: space-between; border-bottom: 1px solid #333; }
        .container { padding: 20px 5%; max-width: 900px; margin: auto; }
        input, select { background: #2b3139; border: 1px solid #444; color: white; padding: 12px; border-radius: 5px; margin: 5px 0; }
        .btn { padding: 12px 20px; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; color: white; }
        .btn-gold { background: var(--gold); color: black; }
        .btn-red { background: var(--red); }
        .btn-green { background: var(--green); }
        .filters { display: flex; gap: 10px; margin-bottom: 20px; background: var(--card); padding: 15px; border-radius: 10px; align-items: center; }
        .ad-card { background: var(--card); padding: 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; border-left: 4px solid var(--gold); margin-bottom: 15px; }
        .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); display: none; flex-direction: column; }
        #msgs { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 10px; background: #000; }
        .msg { padding: 10px 15px; border-radius: 10px; max-width: 70%; background: #2b3139; }
        .msg.me { align-self: flex-end; background: #037dff; }
        .controls { padding: 20px; background: var(--card); display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
    </style>
</head>
<body>
    <div id="viewAuth">
        <div style="width:320px; margin:100px auto; background:var(--card); padding:30px; border-radius:15px; text-align:center;">
            <h2 style="color:var(--gold)">PLATINUM P2P</h2>
            <input type="email" id="email" style="width:100%" placeholder="Correo">
            <input type="password" id="pass" style="width:100%" placeholder="Contraseña">
            <button class="btn btn-gold" style="width:100%; margin-top:10px" onclick="auth()">Ingresar / Registrar</button>
        </div>
    </div>

    <div id="viewP2P" style="display:none;">
        <nav class="nav">
            <h3 style="color:var(--gold); margin:0;">PLATINUM VENEZUELA</h3>
            <button class="btn btn-red" onclick="location.reload()">Salir</button>
        </nav>
        <div class="container">
            <div class="filters">
                <span>Banco:</span>
                <select id="fBank" onchange="renderAds()" style="flex:1">
                    <option value="TODOS">Todos los bancos</option>
                    <option value="Banesco">Banesco</option>
                    <option value="Mercantil">Mercantil</option>
                    <option value="Pago Móvil">Pago Móvil</option>
                </select>
            </div>
            <div id="adsList"></div>
        </div>
    </div>

    <div id="viewChat" class="modal">
        <div class="nav">
            <div>
                <b id="ordStatus" style="color:var(--gold)">ESTADO: ESPERANDO PAGO</b><br>
                <small id="ordIdInfo"></small>
            </div>
            <button class="btn btn-red" onclick="cerrarChat()">X</button>
        </div>
        <div id="msgs"></div>
        <div class="controls">
            <input type="text" id="txtInput" style="flex:1" placeholder="Escribe un mensaje...">
            <button class="btn btn-gold" onclick="enviarMsg()">Enviar</button>
        </div>
        <div class="controls" style="border-top:1px solid #333">
            <button class="btn btn-green" onclick="actualizarStatus('PAGADO')">Notificar Pago</button>
            <button class="btn btn-gold" onclick="actualizarStatus('COMPLETADA')">Liberar Cripto</button>
            <button class="btn btn-red" onclick="actualizarStatus('CANCELADA')">Cancelar Orden</button>
        </div>
    </div>

    <script>
        let me = null, activeOrd = null, loop = null;
        const ads = [
            { id: 1, user: "Admin_Banesco", price: 54.20, bank: "Banesco" },
            { id: 2, user: "Mercantil_Express", price: 54.50, bank: "Mercantil" },
            { id: 3, user: "PagoMovil_Fast", price: 53.90, bank: "Pago Móvil" }
        ];

        async function auth() {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ email: email.value, password: pass.value })
            });
            const data = await res.json();
            if(res.ok) {
                me = data.user;
                viewAuth.style.display = 'none';
                viewP2P.style.display = 'block';
                renderAds();
            }
        }

        function renderAds() {
            const bank = fBank.value;
            adsList.innerHTML = ads.filter(a => bank === 'TODOS' || a.bank === bank).map(a => \`
                <div class="ad-card">
                    <div><b>\${a.user}</b><br><small>Banco: \${a.bank}</small></div>
                    <div style="font-size:22px; font-weight:bold; color:var(--gold)">\${a.price} VES</div>
                    <button class="btn btn-green" onclick="crearOrden('\${a.bank}', \${a.price})">Comprar</button>
                </div>
            \`).join('');
        }

        async function crearOrden(bank, price) {
            const res = await fetch('/api/p2p/order', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ buyer_id: me.id, seller_id: 1, amount: 100, price, bank })
            });
            const data = await res.json();
            activeOrd = data.order_id;
            viewChat.style.display = 'flex';
            ordIdInfo.innerText = "ID: " + activeOrd;
            loop = setInterval(syncChat, 2000);
        }

        async function enviarMsg() {
            if(!txtInput.value) return;
            await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ order_id: activeOrd, sender_id: me.id, text: txtInput.value })
            });
            txtInput.value = '';
        }

        async function syncChat() {
            const res = await fetch('/api/chat/' + activeOrd);
            const data = await res.json();
            msgs.innerHTML = data.msgs.map(m => \`<div class="msg \${m.sender_id === me.id ? 'me' : ''}">\${m.text}</div>\`).join('');
            ordStatus.innerText = "ESTADO: " + data.status;
        }

        async function actualizarStatus(s) {
            await fetch('/api/p2p/status', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ order_id: activeOrd, status: s })
            });
            if(s === 'CANCELADA' || s === 'COMPLETADA') cerrarChat();
        }

        function cerrarChat() { viewChat.style.display = 'none'; clearInterval(loop); }
    </script>
</body>
</html>
`;

// --- 3. RUTAS API ---
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

app.listen(process.env.PORT || 3000, () => console.log("🚀 Platinum P2P Full & Repaired"));
