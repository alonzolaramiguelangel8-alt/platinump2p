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

// --- 1. DEFINICIÓN DE LA INTERFAZ (DEBE IR ARRIBA) ---
const mainHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Platinum Elite P2P</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        :root { --gold: #d4af37; --dark: #0a0a0a; --card: #151515; --green: #2ebd85; --red: #f6465d; }
        body { background: var(--dark); color: #fff; font-family: 'Segoe UI', sans-serif; margin: 0; }
        .nav { background: #000; padding: 15px; display: flex; justify-content: space-around; border-bottom: 2px solid var(--gold); position: sticky; top:0; z-index:100; align-items: center;}
        .nav b { cursor: pointer; color: var(--gold); font-size: 13px; text-transform: uppercase; }
        .container { max-width: 500px; margin: auto; padding: 15px; }
        .card { background: var(--card); border: 1px solid #222; padding: 20px; border-radius: 15px; margin-bottom: 15px; }
        input, select { background: #111; color: #fff; border: 1px solid #333; padding: 12px; border-radius: 8px; width: 100%; box-sizing: border-box; margin-bottom: 10px; font-size: 16px; }
        button { background: linear-gradient(45deg, #d4af37, #f2d06b); border: none; padding: 14px; cursor: pointer; font-weight: bold; border-radius: 8px; width: 100%; color: #000; }
        #chat-box { height: 350px; overflow-y: auto; background: #050505; padding: 15px; border-radius: 10px; border: 1px solid #222; display: flex; flex-direction: column; gap: 10px; margin-bottom: 10px; }
        .msg-line { padding: 10px 14px; border-radius: 15px; max-width: 80%; font-size: 0.95em; line-height: 1.4; }
        .msg-me { background: var(--gold); color: #000; align-self: flex-end; border-bottom-right-radius: 2px; }
        .msg-other { background: #2a2a2a; align-self: flex-start; border-bottom-left-radius: 2px; }
        .hidden { display: none; }
        .order-item { border-left: 3px solid var(--gold); padding: 15px; background: #1a1a1a; border-radius: 10px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
    </style>
</head>
<body>
    <div id="viewAuth" class="container" style="margin-top:80px">
        <div class="card" style="text-align:center">
            <h1 style="color:var(--gold); letter-spacing:4px; margin-bottom:5px">PLATINUM</h1>
            <p style="font-size:10px; color:gray; letter-spacing:2px; margin-bottom:30px">ELITE P2P NETWORK</p>
            <input type="email" id="email" placeholder="Correo Electrónico">
            <input type="password" id="pass" placeholder="Contraseña">
            <button onclick="auth()">INICIAR SESIÓN</button>
        </div>
    </div>

    <div id="viewMain" class="hidden">
        <div class="nav">
            <b onclick="verTab('mercado')">Mercado</b>
            <b onclick="verTab('perfil')">Perfil</b>
            <div style="text-align:right">
                <small style="color:gray; font-size:10px">BALANCE</small><br>
                <b id="valSaldo" style="font-size:14px">0.00</b> <small style="color:var(--gold)">USDT</small>
            </div>
        </div>

        <div class="container">
            <div id="tab-mercado">
                <div class="card">
                    <h4 style="margin-top:0; color:var(--gold)">CREAR ANUNCIO DE VENTA</h4>
                    <select id="vBank">
                        <option value="Banesco">Banesco</option>
                        <option value="Pago Móvil">Pago Móvil</option>
                        <option value="Mercantil">Mercantil</option>
                        <option value="BBVA Provincial">BBVA Provincial</option>
                    </select>
                    <input type="number" id="vMonto" placeholder="Monto USDT">
                    <input type="number" id="vPrecio" placeholder="Precio Total Bs">
                    <button onclick="crearAnuncio()">PUBLICAR AHORA</button>
                </div>
                <h4 style="color:gray">OFERTAS DISPONIBLES</h4>
                <div id="listaOrdenes"></div>
            </div>

            <div id="tab-perfil" class="hidden">
                <div class="card" style="text-align:center">
                    <div style="width:70px; height:70px; background:var(--gold); border-radius:50%; margin: 0 auto 15px; display:flex; align-items:center; justify-content:center; color:#000; font-size:24px; font-weight:bold" id="avatar">U</div>
                    <h2 id="profUser" style="margin:5px 0"></h2>
                    <p id="profKyc" style="color:var(--green); font-size:12px; font-weight:bold"></p>
                    <hr style="border:0; border-top:1px solid #333; margin:20px 0">
                    <button onclick="location.reload()" style="background:#222; color:var(--red); border:1px solid var(--red)">CERRAR SESIÓN</button>
                </div>
            </div>

            <div id="viewChat" class="hidden">
                <div class="card" style="padding:10px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center">
                    <b style="color:var(--gold)">ORDEN EN PROCESO</b>
                    <button onclick="verTab('mercado')" style="width:auto; padding:5px 15px; background:transparent; color:var(--red)">CANCELAR</button>
                </div>
                <div id="chat-box"></div>
                <div style="display:flex; gap:8px">
                    <input type="text" id="msgInput" style="margin:0" placeholder="Escribe un mensaje...">
                    <button onclick="enviarMsg()" style="width:60px; font-size:20px">></button>
                </div>
                <button style="background:var(--green); color:white; margin-top:15px; height:55px; font-size:16px">HE RECIBIDO EL PAGO</button>
            </div>
        </div>
    </div>

    <script>
        const socket = io();
        let me = null, activeOrd = null;

        async function auth() {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ email: email.value, password: pass.value })
            });
            const data = await res.json();
            if(data.success) {
                me = data.user;
                viewAuth.classList.add('hidden');
                viewMain.classList.remove('hidden');
                valSaldo.innerText = me.balance_usdt;
                profUser.innerText = me.username.toUpperCase();
                profKyc.innerText = "VERIFICADO • " + me.kyc_status;
                avatar.innerText = me.username[0].toUpperCase();
                cargarMercado();
            } else { alert("Error de acceso"); }
        }

        async function cargarMercado() {
            const res = await fetch('/api/ordenes');
            const data = await res.json();
            listaOrdenes.innerHTML = data.map(o => \`
                <div class="order-item">
                    <div>
                        <b style="font-size:14px">\${o.bank}</b><br>
                        <small style="color:gray">\${o.amount_usdt} USDT</small>
                    </div>
                    <div style="text-align:right">
                        <b style="color:var(--gold); font-size:18px">\${o.price_ves} Bs</b><br>
                        <button onclick="abrirChat('\${o.order_id}')" style="width:80px; padding:6px; font-size:11px; margin-top:5px">COMPRAR</button>
                    </div>
                </div>
            \`).join('');
        }

        function abrirChat(id) {
            activeOrd = id;
            viewChat.classList.remove('hidden');
            document.getElementById('tab-mercado').classList.add('hidden');
            document.getElementById('tab-perfil').classList.add('hidden');
            document.getElementById('chat-box').innerHTML = "";
            socket.emit('unirse_p2p', id);
        }

        function enviarMsg() {
            if(!msgInput.value) return;
            socket.emit('msg_p2p', { 
                order_id: activeOrd, 
                sender_id: me.id, 
                username: me.username, 
                text: msgInput.value 
            });
            msgInput.value = "";
        }

        socket.on('update_chat', (data) => {
            const box = document.getElementById('chat-box');
            const clase = data.username === me.username ? 'msg-me' : 'msg-other';
            box.innerHTML += \`<div class="msg-line \${clase}"><b>\${data.username}:</b> \${data.text}</div>\`;
            box.scrollTop = box.scrollHeight;
        });

        async function crearAnuncio() {
            if(!vMonto.value || !vPrecio.value) return alert("Completa los datos");
            await fetch('/api/crear-orden', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    seller_id: me.id, 
                    amount: vMonto.value, 
                    price: vPrecio.value, 
                    bank: vBank.value 
                })
            });
            vMonto.value = ""; vPrecio.value = "";
            cargarMercado();
            alert("¡Anuncio publicado!");
        }

        function verTab(t) {
            document.getElementById('tab-mercado').classList.toggle('hidden', t !== 'mercado');
            document.getElementById('tab-perfil').classList.toggle('hidden', t !== 'perfil');
            viewChat.classList.add('hidden');
            if(t === 'mercado') cargarMercado();
        }
    </script>
</body>
</html>
`;

// --- 2. RUTAS Y LÓGICA DEL SERVIDOR ---

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
    await pool.query("INSERT INTO orders (seller_id, amount_usdt, price_ves, bank, status) VALUES ($1,$2,$3,$4,'ABIERTA')", 
        [seller_id, amount, price, bank]);
    res.json({ success: true });
});

// --- 3. SOCKET.IO ---
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (order_id) => { socket.join(order_id); });
    socket.on('msg_p2p', async (data) => {
        const { order_id, sender_id, username, text } = data;
        await pool.query("INSERT INTO messages (order_id, sender_id, text) VALUES ($1,$2,$3)", [order_id, sender_id, text]);
        io.to(order_id).emit('update_chat', { username, text });
    });
});

// --- 4. INICIALIZACIÓN DB ---
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY, username TEXT UNIQUE, email TEXT UNIQUE, password_hash TEXT,
                balance_usdt DECIMAL(18,2) DEFAULT 1000.00, kyc_status TEXT DEFAULT 'NO VERIFICADO'
            );
            CREATE TABLE IF NOT EXISTS orders (
                order_id UUID DEFAULT gen_random_uuid() PRIMARY KEY, buyer_id INTEGER REFERENCES users(id),
                seller_id INTEGER REFERENCES users(id), amount_usdt DECIMAL(18,2), price_ves DECIMAL(18,2),
                bank TEXT, status TEXT DEFAULT 'ABIERTA'
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY, order_id UUID REFERENCES orders(order_id),
                sender_id INTEGER REFERENCES users(id), text TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
    } catch (err) { console.error(err); }
}
initDB();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("🚀 Platinum Elite P2P Ready"));
