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

// Crear tablas con logs detallados
async function inicializarTablas() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin BOOLEAN DEFAULT FALSE,
                kyc_level INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS wallets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                balance_available DECIMAL(18,2) DEFAULT 0
            );
        `);
        console.log("✅ Tablas verificadas/creadas");
    } catch (err) {
        console.error("❌ Error inicializando tablas:", err);
    }
}
inicializarTablas();

// RUTA DE REGISTRO BLINDADA
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "Faltan datos" });

    try {
        // 1. Verificamos si ya existe antes de intentar insertar
        const checkUser = await pool.query("SELECT id FROM users WHERE email = $1 OR username = $2", [email, username]);
        if (checkUser.rows.length > 0) {
            return res.status(400).json({ error: "El usuario o email ya existe en el sistema" });
        }

        // 2. Verificamos si será el primer usuario (Admin)
        const countRes = await pool.query("SELECT COUNT(*) FROM users");
        const isFirst = parseInt(countRes.rows[0].count) === 0;

        const hashed = await bcrypt.hash(password, 10);
        
        // 3. Insertar usuario
        const newUser = await pool.query(
            "INSERT INTO users (username, email, password_hash, is_admin, kyc_level) VALUES ($1, $2, $3, $4, 2) RETURNING id",
            [username.toLowerCase(), email.toLowerCase(), hashed, isFirst]
        );

        // 4. Crear Wallet
        await pool.query("INSERT INTO wallets (user_id, balance_available) VALUES ($1, 1000.00)", [newUser.rows[0].id]);

        res.json({ success: true, message: isFirst ? "Admin creado" : "Usuario creado" });
    } catch (err) {
        console.error("Error en registro:", err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// RUTA DE LOGIN
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email.toLowerCase()]);
        if (result.rows.length === 0) return res.status(400).json({ error: "Usuario no encontrado" });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(400).json({ error: "Contraseña incorrecta" });

        res.json({ success: true, user: { id: user.id, username: user.username, is_admin: user.is_admin } });
    } catch (err) {
        res.status(500).json({ error: "Error en login" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor en puerto ${PORT}`));
