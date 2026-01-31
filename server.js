const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static('/root/platinum_app'));

const pool = new Pool({
    user: 'postgres', host: 'localhost', database: 'platinum_db',
    password: 'tu_password', port: 5432,
});

// LOGIN
app.post('/login', async (req, res) => {
    const { usuario, clave } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [usuario]);
        if (result.rows.length > 0 && await bcrypt.compare(clave, result.rows[0].password_hash)) {
            res.json(result.rows[0]);
        } else { res.status(401).json({ error: "Fallo" }); }
    } catch (e) { res.status(500).send(e); }
});

// HISTORIAL Y MERCADO
app.get('/ordenes', async (req, res) => {
    const { user_id, historico } = req.query;
    let query = "SELECT * FROM orders WHERE estatus = 'ABIERTA'";
    if (historico === 'true') {
        query = `SELECT * FROM orders WHERE vendedor_id = ${user_id} OR estatus = 'FINALIZADA' ORDER BY id DESC LIMIT 10`;
    }
    const r = await pool.query(query);
    res.json(r.rows);
});

// CREAR ORDEN Y LIBERAR (Igual que antes pero con aviso global)
app.post('/crear-orden', async (req, res) => {
    const { seller_id, amount, price } = req.body;
    await pool.query('INSERT INTO orders (vendedor_id, monto_usdt, monto_bs, estatus) VALUES ($1, $2, $3, $4)', [seller_id, amount, price, 'ABIERTA']);
    io.emit('nuevo_anuncio');
    res.json({ ok: true });
});

app.post('/liberar-fondos', async (req, res) => {
    const { ordenId, vendedorId, compradorId, monto } = req.body;
    await pool.query('BEGIN');
    await pool.query('UPDATE users SET balance_usdt = balance_usdt - $1 WHERE id = $2', [monto, vendedorId]);
    await pool.query('UPDATE users SET balance_usdt = balance_usdt + $1 WHERE id = $2', [monto, compradorId]);
    await pool.query("UPDATE orders SET estatus = 'FINALIZADA' WHERE id = $1", [ordenId]);
    await pool.query('COMMIT');
    io.emit('finalizado', { ordenId });
    res.json({ ok: true });
});

// SOCKETS CON NOTIFICACIÓN VISUAL
io.on('connection', (socket) => {
    socket.on('unirse_p2p', (id) => socket.join("orden_" + id));
    socket.on('msg_p2p', (data) => {
        io.to("orden_" + data.ordenId).emit('update_chat', data);
    });
});

server.listen(3001, '0.0.0.0', () => console.log('🚀 PLATINUM V3 - FULL AUTO'));
