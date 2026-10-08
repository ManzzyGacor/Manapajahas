// lib/websocket_game.js
import { WebSocketServer } from 'ws';

export function setupGameWebSocket(server) {
    const wss = new WebSocketServer({ server });
    const rooms = {};

    wss.on('connection', function connection(ws, req) {
        // Daftar Endpoint WebSocket yang diizinkan
        const allowedPaths = ['/ws-picopark', '/ws-stickduel', '/ws-rpg', '/ws-spotify'];
        
        if (!allowedPaths.includes(req.url)) {
            ws.close();
            return;
        }

        ws.on('message', function incoming(message) {
            let data;
            try {
                data = JSON.parse(message);
            } catch (e) {
                return;
            }
            
            const roomId = req.url + "_" + data.room;

            // KETIKA USER BERGABUNG KE ROOM
            if (data.type === 'join') {
                if (!rooms[roomId]) { 
                    rooms[roomId] = { players: [], currentTrack: null, currentTime: 0, isPlaying: false }; 
                }
                const room = rooms[roomId];
                
                // Atur batas maksimal player per game
                let maxPlayers = 10; // Default untuk Spotify Rooms
                if (req.url === '/ws-stickduel') maxPlayers = 2;
                else if (req.url === '/ws-picopark') maxPlayers = 3;
                else if (req.url === '/ws-rpg') maxPlayers = 5; // RPG Co-op Raid

                if (room.players.length >= maxPlayers) {
                    ws.send(JSON.stringify({ type: 'error', msg: 'Room Penuh!' }));
                    return;
                }

                ws.roomId = roomId;
                ws.playerName = data.name || 'Player';

                // Simpan atribut khusus tiap game
                if (req.url === '/ws-stickduel') {
                    ws.playerColor = data.color || '#fff';
                    ws.playerWeapon = data.weapon || 'sword';
                } else if (req.url === '/ws-spotify') {
                    ws.isHost = data.isHost || false;
                } else if (req.url === '/ws-rpg') {
                    ws.playerLevel = data.level || 1;
                }

                const playerIndex = room.players.length;
                room.players.push(ws);
                ws.send(JSON.stringify({ type: 'joined', index: playerIndex }));

                broadcastRoomState(roomId, req.url);
            } 
            // KETIKA USER MENGIRIM AKSI (MOVE, ATTACK, PLAY, SYNC, DLL)
            else {
                // Simpan state media khusus untuk Host Spotify
                if (req.url === '/ws-spotify') {
                    if (data.type === 'play' && rooms[roomId]) {
                        rooms[roomId].currentTrack = data.track;
                        rooms[roomId].currentTime = 0;
                        rooms[roomId].isPlaying = true;
                    } else if (data.type === 'sync' && rooms[roomId]) {
                        rooms[roomId].currentTime = data.time;
                        rooms[roomId].isPlaying = (data.state === 'playing');
                    }
                }

                // Broadcast data aksi ke semua player lain di room yang sama
                if (rooms[roomId]) {
                    rooms[roomId].players.forEach(client => {
                        if (client !== ws && client.readyState === 1) {
                            client.send(JSON.stringify(data));
                        }
                    });
                }
            }
        });

        // KETIKA KONEKSI TERPUTUS
        ws.on('close', () => {
            const roomId = ws.roomId;
            if (rooms[roomId]) {
                rooms[roomId].players = rooms[roomId].players.filter(client => client !== ws);
                
                broadcastRoomState(roomId, req.url);

                if (rooms[roomId].players.length === 0) {
                    delete rooms[roomId];
                }
            }
        });

        // FUNGSI BROADCAST STATE ROOM (Otomatis menyesuaikan game)
        function broadcastRoomState(roomId, url) {
            const room = rooms[roomId];
            if (!room) return;

            let stateData = { type: 'room_state', count: room.players.length };

            if (url === '/ws-stickduel') {
                stateData.names = room.players.map(p => p.playerName);
                stateData.players = room.players.map(p => ({
                    name: p.playerName,
                    color: p.playerColor,
                    weapon: p.playerWeapon
                }));
            } else if (url === '/ws-spotify') {
                stateData.members = room.players.map(p => ({
                    name: p.playerName,
                    isHost: p.isHost
                }));
                // Kirim state lagu agar Guest yang baru masuk bisa sinkron
                stateData.currentTrack = room.currentTrack;
                stateData.currentTime = room.currentTime;
                stateData.isPlaying = room.isPlaying;
            } else if (url === '/ws-rpg') {
                stateData.names = room.players.map(p => p.playerName);
                stateData.players = room.players.map(p => ({
                    name: p.playerName,
                    level: p.playerLevel
                }));
            } else {
                stateData.names = room.players.map(p => p.playerName);
            }

            room.players.forEach(client => {
                if (client.readyState === 1) {
                    client.send(JSON.stringify(stateData));
                }
            });
        }
    });

    console.log('[✔] Game WebSocket Router loaded successfully.');
}