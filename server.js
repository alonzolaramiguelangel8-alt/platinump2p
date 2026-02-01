const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- 1. CONFIGURACIÓN DE BASE DE DATOS ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Crear tablas necesarias para el P2P y Chat
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
            CREATE TABLE IF NOT EXISTS wallets (
                user_id INTEGER REFERENCES users(id),
                balance_usdt DECIMAL(18,2) DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS orders (
                order_id SERIAL PRIMARY KEY,
                buyer_id INTEGER REFERENCES users(id),
                seller_id INTEGER REFERENCES users(id),
                amount_usdt DECIMAL(18,2),
                price_ves DECIMAL(18,2),
                bank TEXT,
                status TEXT DEFAULT 'ABIERTA'
            );
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(order_id),
                sender_id INTEGER REFERENCES users(id),
                text TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Sistema de Base de Datos P2P listo");
    } catch (err) { console.log("Error DB:", err); }
}
initDB();

// --- 2. GENERADOR DE ARCHIVOS HTML (Para evitar el error ENOENT) ---

const loginHTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Login - Platinum P2P</title><style>body{background:#0b0e11;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.box{background:#1e2329;padding:30px;border-radius:10px;width:320px;text-align:center}input{width:100%;padding:12px;margin:10px 0;border-radius:5px;border:1px solid #474d57;background:#2b2f36;color:white;box-sizing:border-box}button{width:100%;padding:12px;background:#f3ba2f;border:none;border-radius:5px;cursor:pointer;font-weight:bold;margin-top:10px}</style></head><body><div class="box"><h2 style="color:#f3ba2f">PLATINUM P2P 🇻🇪</h2><input type="text" id="user" placeholder="Usuario (solo registro)"><input type="email" id="email" placeholder="Correo"><input type="password" id="pass" placeholder="Contraseña"><button onclick="auth('register')">REGISTRARSE</button><button onclick="auth('login')" style="background:transparent;color:#f3ba2f;border:1px solid #f3ba2f">INGRESAR</button></div><script>async function auth(t){const e={username:document.getElementById("user").value,email:document.getElementById("email").value,password:document.getElementById("pass").value},n=await fetch("/api/auth/"+t,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)}),a=await n.json();n.ok?("login"===t?(localStorage.setItem("user",JSON.stringify(a.user)),window.location.href="/dashboard"):alert("Registro exitoso")):alert("Error: "+a.error)}</script></body></html>`;

const dashboardHTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>P2P Marketplace</title><style>body{background:#0b0e11;color:white;font-family:sans-serif;padding:20px}.card{background:#1e2329;padding:20px;border-radius:10px;margin-bottom:15px;border-left:5px solid #f3ba2f}.btn{background:#f3ba2f;border:none;padding:10px 20px;border-radius:5px;cursor:pointer;font-weight:bold}.chat-box{height:150px;overflow-y:auto;background:#000;padding:10px;margin:10px 0;border-radius:5px}</style></head><body><h1>Mercado P2P Venezuela</h1><div id="market"><h3>Oferta Disponible</h3><div class="card"><p>Vendedor: <b>Admin_Platinum</b></p><p>Tasa: <b>54.20 VES</b></p><p>Banco: <b>Banesco / Pago Móvil</b></p><button class="btn" onclick="crearOrden()">COMPRAR USDT</button></div></div><div id="ordenArea" style="display:none"><h2>Orden Activa #<span id="idOrd"></span></h2><div class="chat-box" id="chat"></div><input type="text" id="msg" placeholder="Escribe al vendedor..." style="width:70%;padding:10px"><button onclick="enviarMsg()" style="padding:10px">Enviar</button></div><script>let user=JSON.parse(localStorage.getItem("user")),ordenActual=null;if(!user)window.location.href="/";async function crearOrden(){const r=await fetch("/api/p2p/order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({buyer_id:user.id,seller_id:1,amount:100,price:54.20,bank:"Banesco"})});const res=await r.json();ordenActual=res.order_id;document.getElementById("ordenArea").style.display="block";document.getElementById("idOrd").innerText=ordenActual;setInterval(cargarChat,2000)}async function enviarMsg(){const t=document.getElementById("msg").value;await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({order_id:ordenActual,sender_id:user.id,text:t})});document.getElementById("msg").value=""}async function cargarChat(){const r=await fetch("/api/chat/"+ordenActual),data=await r.json();document.getElementById("chat").innerHTML=data.map(m=>"<div><b>"+(m.sender_id==user.id?"Tú":"Vendedor")+":</b> "+m.text+"</div>").join("")}</script></body></html>`;

fs.writeFileSync(path.join(__dirname, 'login.html'), loginHTML);
fs.writeFileSync(path.join(__dirname, 'index.html'), dashboardHTML);

// --- 3. RUTAS DE NAVEGACIÓN ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- 4. API DE USUARIOS ---
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        const u = await pool.query("INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username", [username.toLowerCase(), email.toLowerCase(), hashed]);
        await pool.query("INSERT INTO wallets (user_id) VALUES ($1)", [u.rows[0].id]);
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "Ya existe el usuario" }); }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const u = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        const v = await bcrypt.compare(password, u.rows[0].password_hash);
        if(v) res.json({ success: true, user: u.rows[0] });
        else res.status(400).json({ error: "Clave incorrecta" });
    } catch (e) { res.status(400).json({ error: "No existe el usuario" }); }
});

// --- 5. API P2P & CHAT ---
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
app.listen(PORT, () => console.log(`🚀 Platinum P2P funcionando en puerto ${PORT}`));
