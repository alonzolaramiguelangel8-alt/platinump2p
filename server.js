const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Inicialización de tablas simplificada
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                kyc_level INTEGER DEFAULT 2
            );
            CREATE TABLE IF NOT EXISTS wallets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                balance_available DECIMAL(18,2) DEFAULT 1000.00
            );
        `);
        console.log("✅ Base de datos verificada");
    } catch (err) {
        console.error("❌ Error inicializando DB:", err);
    }
}
initDB();

// RUTAS
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));

app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const hashed = await bcrypt.hash(password, 10);
        const newUser = await pool.query(
            "INSERT INTO users (username, email, password_hash, is_admin) VALUES ($1, $2, $3, true) RETURNING id",
            [username.toLowerCase(), email.toLowerCase(), hashed]
        );
        await pool.query("INSERT INTO wallets (user_id) VALUES ($1)", [newUser.rows[0].id]);
        res.json({ success: true });
    } catch (e) {
        console.log(e);
        res.status(400).json({ error: "El usuario ya existe o hay un error de conexión" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        if (result.rows.length === 0) return res.status(400).json({ error: "Usuario no encontrado" });
        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!valid) return res.status(400).json({ error: "Contraseña incorrecta" });
        res.json({ success: true, user: result.rows[0] });
    } catch (e) { res.status(500).json({ error: "Error en el servidor" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor listo en puerto ${PORT}`));
