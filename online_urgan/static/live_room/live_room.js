/* ==========================================================================
   Jonli dars xonasi — WebSocket signaling + WebRTC mesh + UI mantiq
   --------------------------------------------------------------------------
   users  — xonadagi barcha qatnashchilar (o'zim + boshqalar)
   peers  — har bir masofaviy qatnashchi uchun RTCPeerConnection
   meters — har bir foydalanuvchi uchun AudioContext analizatori (audio meter)
   ========================================================================== */
(function () {
    'use strict';

    /* -------------------------------------------------- konfiguratsiya */
    const configNode = document.getElementById('liveRoomConfig');
    let CFG = {};
    try {
        CFG = JSON.parse((configNode && configNode.textContent) || '{}');
    } catch (error) {
        console.error('[live-room] config parse failed', error);
    }

    const me = {
        id: Number(CFG.userId || 0),
        name: CFG.userName || 'Foydalanuvchi',
        role: CFG.role === 'teacher' ? 'teacher' : 'student',
    };
    const teacherId = CFG.teacherId ? Number(CFG.teacherId) : null;
    const isTeacher = me.role === 'teacher';
    const wsPath = CFG.wsPath || `/ws/live/${Number(CFG.lessonId || 0)}/`;
    const homeUrl = CFG.homeUrl || '/';
    const dashboardUrl = CFG.dashboardUrl || '/';

    const rtcConfig = {
        iceServers: Array.isArray(CFG.iceServers) && CFG.iceServers.length
            ? CFG.iceServers
            : [{ urls: 'stun:stun.l.google.com:19302' }],
        bundlePolicy: 'max-bundle',
        iceCandidatePoolSize: 0,
    };

    /* --------------------------------------------------------------- DOM */
    const $ = (id) => document.getElementById(id);
    const ui = {
        stage: $('stageView'),
        grid: $('videoGrid'),
        screenVideo: $('screenVideo'),
        screenChip: $('screenChip'),
        hint: $('stageHint'),
        hintText: $('stageHintText'),
        pip: $('pipWindow'),
        pipVideo: $('pipVideo'),
        pipPlaceholder: $('pipPlaceholder'),
        pipInitials: $('pipInitials'),
        pipName: $('pipName'),
        pipMic: $('pipMic'),
        pipMeter: $('pipMeter'),
        speakingChip: $('speakingChip'),
        speakingName: $('speakingName'),
        peopleList: $('peopleList'),
        peopleCount: $('peopleCount'),
        countNum: $('participantCountNum'),
        chat: $('chatMessages'),
        chatForm: $('chatForm'),
        chatInput: $('chatInput'),
        micBtn: $('toggleMicBtn'),
        micText: $('micBtnText'),
        shareBtn: $('shareScreenBtn'),
        shareText: $('shareScreenText'),
        muteAllBtn: $('muteAllBtn'),
        muteAllText: $('muteAllText'),
        fullscreenBtn: $('toggleFullscreenBtn'),
        leaveBtn: $('leaveRoomBtn'),
        badge: $('liveBadge'),
        badgeText: $('liveBadgeText'),
        copyBtn: $('copyRoomLink'),
        toasts: $('toastStack'),
    };

    const ICON = {
        micOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>',
        micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
        max: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>',
        min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>',
        dock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
        kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
    };

    /* ------------------------------------------------------------- holat */
    const users = new Map();
    const peers = new Map();
    const meters = new Map();
    const pendingCandidates = new Map();
    const negotiateBusy = new Set();

    let socket = null;
    let joined = false;
    let leaving = false;

    let localStream = null;
    let localAudio = null;
    let localVideo = null;
    let micOn = true;
    let mutedByHost = false;

    let screenStream = null;
    let screenOwnerId = null;
    let maximizedId = null;
    let dockVisible = false;

    const audioCtxRef = { ctx: null };

    /* ------------------------------------------------------ yordamchilar */
    const esc = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase()).join('') || '?';
    }

    const isHostUser = (id) => teacherId != null && Number(id) === teacherId;

    function toast(message, kind) {
        if (!ui.toasts) return;
        const node = document.createElement('div');
        node.className = 'toast' + (kind ? ` toast--${kind}` : '');
        node.textContent = message;
        ui.toasts.appendChild(node);
        setTimeout(() => node.remove(), 4000);
    }

    function wsSend(payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(payload));
        return true;
    }

    const sendSignal = (type, extra) => wsSend(Object.assign({ type }, extra || {}));

    function upsertUser(id, data) {
        id = Number(id);
        if (!id) return null;
        let user = users.get(id);
        if (!user) {
            user = {
                id,
                name: (data && data.name) || `Qatnashchi ${id}`,
                role: isHostUser(id) ? 'teacher' : ((data && data.role) || 'student'),
                micMuted: false,
                speaking: false,
                level: 0,
            };
            users.set(id, user);
        } else if (data) {
            if (data.name) user.name = data.name;
            if (data.role) user.role = data.role;
            if (isHostUser(id)) user.role = 'teacher';
        }
        return user;
    }

    function sortedUsers() {
        return [...users.values()].sort((a, b) => {
            if (a.id === me.id) return -1;
            if (b.id === me.id) return 1;
            const ah = isHostUser(a.id) ? 0 : 1;
            const bh = isHostUser(b.id) ? 0 : 1;
            return ah !== bh ? ah - bh : a.name.localeCompare(b.name, 'uz');
        });
    }

    function streamFor(id) {
        if (Number(id) === me.id) return localStream;
        const entry = peers.get(Number(id));
        return entry ? entry.remoteStream : null;
    }

    /* ==================================================================
       WEBSOCKET
       ================================================================== */
    function connect() {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        socket = new WebSocket(`${proto}://${window.location.host}${wsPath}`);

        socket.addEventListener('open', () => {
            wsSend({ type: 'join' });
            if (localStream) sendMicState();
        });

        socket.addEventListener('close', () => {
            joined = false;
            if (leaving) return;
            toast('Ulanish uzildi, qayta ulanmoqda...', 'warn');
            setTimeout(() => { if (!leaving) connect(); }, 2000);
        });

        socket.addEventListener('error', () => console.warn('[live-room] WS error'));

        socket.addEventListener('message', (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (error) { return; }
            if (data && data.type) {
                onMessage(data).catch((error) => console.error('[live-room]', data.type, error));
            }
        });
    }

    async function onMessage(msg) {
        switch (msg.type) {
            case 'room-state': return onRoomState(msg);
            case 'presence': return onPresence(msg);
            case 'chat-message': return addChat(msg.sender, msg.message, msg.sender_id === me.id ? 'me' : '');
            case 'mic-state': return onRemoteMicState(msg.sender_id, !!msg.muted);
            case 'mute_user':
            case 'unmute_user':
            case 'mute_all':
            case 'unmute_all': return onMuteCommand(msg);
            case 'kick_user': return onKick(msg);
            case 'screen-share-start': return onScreenStart(msg);
            case 'screen-share-stop': return onScreenStop(msg);
            case 'lesson-ended':
                ui.badgeText.textContent = 'Yakunlandi';
                ui.badge.classList.remove('pill--live');
                return addChat('Tizim', msg.message || 'Dars yakunlandi.', 'system');
            case 'webrtc-offer':
            case 'webrtc-answer':
            case 'webrtc-candidate': return onSignal(msg);
            default: return undefined;
        }
    }

    function onRoomState(msg) {
        joined = true;

        if (msg.mic_muted_by_host) {
            mutedByHost = true;
            applyMicState();
        }

        upsertUser(me.id, { name: msg.user_name || me.name, role: msg.role || me.role });
        (msg.participants || []).forEach((p) => {
            const user = upsertUser(p.id, { name: p.name, role: p.role });
            if (user && p.mic_muted) user.micMuted = true;
        });
        (msg.chat_history || []).forEach((item) => {
            addChat(item.sender, item.message, item.sender_id === me.id ? 'me' : '');
        });

        if (msg.screen_owner_id) {
            screenOwnerId = Number(msg.screen_owner_id);
            const owner = users.get(screenOwnerId);
            ui.screenChip.textContent = owner ? `${owner.name} ekranni uzatmoqda` : 'Ekran uzatilmoqda';
            dockVisible = false;
        }

        refreshAll();

        (msg.participants || []).forEach((p) => {
            const id = Number(p.id);
            if (id === me.id) return;
            connectPeer(id, me.id < id);
        });
    }

    function onPresence(msg) {
        const id = Number(msg.sender_id);
        if (!id || id === me.id) return;

        if (msg.left) {
            users.delete(id);
            destroyPeer(id);
            if (screenOwnerId === id) { screenOwnerId = null; renderScreen(); }
            if (maximizedId === id) maximizedId = null;
            refreshAll();
            return;
        }

        upsertUser(id, { name: msg.name || msg.sender, role: msg.role });
        refreshAll();
        if (!msg.fresh) connectPeer(id, me.id < id);
    }

    function sendMicState() {
        sendSignal('mic-state', { muted: !micOn || mutedByHost });
    }

    /* ==================================================================
       WEBRTC
       ================================================================== */
    function isScreenLabel(label) {
        return /(screen|window|display|monitor|tab|screenshare)/i.test(label || '');
    }

    function newPeer(id) {
        const pc = new RTCPeerConnection(rtcConfig);
        const entry = {
            id,
            pc,
            polite: me.id > id,
            makingOffer: false,
            ignoreOffer: false,
            remoteStream: new MediaStream(),
            remoteScreenTrack: null,
            senders: { audio: null, video: null, screen: null },
        };
        peers.set(id, entry);

        pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            sendSignal('webrtc-candidate', { target_user_id: id, candidate: event.candidate.toJSON() });
        };

        pc.onnegotiationneeded = () => {
            negotiate(entry).catch((error) => console.warn('[live-room] negotiate', error));
        };

        pc.ontrack = (event) => {
            const track = event.track;
            const screenTrack = track.kind === 'video' && isScreenLabel(track.label);

            if (screenTrack) {
                entry.remoteScreenTrack = track;
                track.onunmute = renderScreen;
                track.onended = () => {
                    if (entry.remoteScreenTrack === track) entry.remoteScreenTrack = null;
                    renderScreen();
                };
                renderScreen();
            } else if (!entry.remoteStream.getTracks().some((item) => item.id === track.id)) {
                entry.remoteStream.addTrack(track);
                track.onunmute = refreshMediaTiles;
                track.onended = () => {
                    entry.remoteStream.removeTrack(track);
                    refreshMediaTiles();
                };
            }

            upsertUser(id, null);
            refreshAll();
            if (track.kind === 'audio') startRemoteMeter(id);
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') {
                try { pc.restartIce(); } catch (error) { /* ignore */ }
            }
        };

        if (localStream) addLocalTracks(entry);
        return entry;
    }

    function pcHasTracks(entry) {
        return entry.pc.getSenders().some((sender) => !!sender.track);
    }

    function connectPeer(id, startNegotiation) {
        id = Number(id);
        if (!id || id === me.id) return peers.get(id);
        let entry = peers.get(id);
        if (!entry) entry = newPeer(id);
        if (localStream) addLocalTracks(entry);
        if (startNegotiation && entry.pc.signalingState === 'stable' && pcHasTracks(entry)) {
            negotiate(entry).catch(() => {});
        }
        return entry;
    }

    function addLocalTracks(entry) {
        if (!entry || !localStream) return;
        const pc = entry.pc;
        if (localAudio) {
            const current = entry.senders.audio;
            if (!current || current.track !== localAudio || current.track.readyState === 'ended') {
                try { entry.senders.audio = pc.addTrack(localAudio, localStream); } catch (error) { /* noop */ }
            }
        }
        if (localVideo && !entry.senders.video) {
            try { entry.senders.video = pc.addTrack(localVideo, localStream); } catch (error) { /* noop */ }
        }
    }

    async function negotiate(entry) {
        const pc = entry.pc;
        if (pc.signalingState !== 'stable' || negotiateBusy.has(entry.id)) return;
        negotiateBusy.add(entry.id);
        try {
            entry.makingOffer = true;
            await pc.setLocalDescription();
            sendSignal('webrtc-offer', { target_user_id: entry.id, offer: pc.localDescription });
        } finally {
            entry.makingOffer = false;
            negotiateBusy.delete(entry.id);
        }
    }

    async function onSignal(msg) {
        const id = Number(msg.sender_id);
        if (!id || id === me.id) return;
        let entry = peers.get(id);
        if (!entry) entry = newPeer(id);
        const pc = entry.pc;

        if (msg.type === 'webrtc-offer' && msg.offer) {
            const collision = entry.makingOffer || pc.signalingState !== 'stable';
            if (collision && !entry.polite) {
                entry.ignoreOffer = true;
                return;
            }
            if (collision) {
                await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
            }
            entry.ignoreOffer = false;
            await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));
            await flushCandidates(id);
            if (!localStream) await startLocalMedia();
            if (localStream) addLocalTracks(entry);
            await pc.setLocalDescription();
            sendSignal('webrtc-answer', { target_user_id: id, answer: pc.localDescription });
            return;
        }

        if (msg.type === 'webrtc-answer' && msg.answer) {
            if (pc.signalingState !== 'have-local-offer') return;
            await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
            await flushCandidates(id);
            return;
        }

        if (msg.type === 'webrtc-candidate' && msg.candidate) {
            const candidate = new RTCIceCandidate(msg.candidate);
            if (!pc.remoteDescription || !pc.remoteDescription.type) {
                const list = pendingCandidates.get(id) || [];
                list.push(candidate);
                pendingCandidates.set(id, list);
                return;
            }
            try {
                await pc.addIceCandidate(candidate);
            } catch (error) {
                if (!entry.ignoreOffer) console.warn('[live-room] ICE candidate ignored', error);
            }
        }
    }

    async function flushCandidates(id) {
        const list = pendingCandidates.get(id);
        const entry = peers.get(id);
        if (!list || !entry) return;
        pendingCandidates.delete(id);
        for (const candidate of list) {
            try { await entry.pc.addIceCandidate(candidate); } catch (error) { /* ignore */ }
        }
    }

    function destroyPeer(id) {
        const entry = peers.get(id);
        if (!entry) return;
        try {
            entry.pc.onicecandidate = null;
            entry.pc.onnegotiationneeded = null;
            entry.pc.ontrack = null;
            entry.pc.close();
        } catch (error) { /* ignore */ }
        peers.delete(id);
        stopMeter(id);
        pendingCandidates.delete(id);
    }

    /* ------------------------------------------------------------------
       LOKAL MEDIA
       ------------------------------------------------------------------ */
    async function startLocalMedia() {
        if (localStream) return localStream;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            toast('Brauzer kamera/mikrofonni qo\'llab-quvvatlamaydi.', 'error');
            return null;
        }

        const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
                audio: audioConstraints,
            });
        } catch (videoError) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraints });
            } catch (audioError) {
                console.error('[live-room] media denied', audioError);
                toast('Kamera va mikrofon ruxsati berilmadi.', 'error');
                return null;
            }
        }

        localAudio = localStream.getAudioTracks()[0] || null;
        localVideo = localStream.getVideoTracks()[0] || null;
        applyMicState();

        const own = upsertUser(me.id, { name: me.name, role: me.role });
        own.micMuted = !micOn || mutedByHost;

        refreshAll();
        peers.forEach((entry) => addLocalTracks(entry));

        if (localAudio && !own.micMuted) startMeter(me.id, localStream, null);
        return localStream;
    }

    function applyMicState() {
        if (localAudio) localAudio.enabled = micOn && !mutedByHost;
    }

    function toggleMic() {
        if (mutedByHost) {
            toast('Mikrofon ustoz tomonidan o\'chirilgan.', 'warn');
            return;
        }
        micOn = !micOn;
        applyMicState();
        sendMicState();
        updateMicButton();

        const own = upsertUser(me.id, { name: me.name, role: me.role });
        if (own) own.micMuted = !micOn;

        if (!localAudio) startLocalMedia().catch(() => {});
        else if (micOn) startMeter(me.id, localStream, null);
        else stopMeter(me.id);

        renderPeople();
        refreshMediaTiles();
    }

    function updateMicButton() {
        if (!ui.micBtn) return;
        const on = micOn && !mutedByHost;
        ui.micText.textContent = on ? 'Mikrofon yoniq' : 'Mikrofon o\'chirilgan';
        ui.micBtn.classList.toggle('ctrl-btn--on', on);
        ui.micBtn.classList.toggle('ctrl-btn--muted', !on);
    }

    /* ------------------------------------------------------------------
       MUTE BOSHQARUVI (ustoz tomonidan)
       ------------------------------------------------------------------ */
    function onRemoteMicState(senderId, muted) {
        const user = users.get(Number(senderId));
        if (!user) return;
        user.micMuted = muted;
        if (muted) stopMeter(user.id);
        else startRemoteMeter(user.id);
        renderPeople();
        refreshMediaTiles();
    }

    function onMuteCommand(msg) {
        const target = msg.target_user_id == null ? null : Number(msg.target_user_id);
        const muted = msg.muted != null ? !!msg.muted
            : (msg.type === 'mute_all' || msg.type === 'mute_user');

        if (msg.type === 'mute_all' || msg.type === 'unmute_all') {
            users.forEach((user) => { if (user.id !== me.id) user.micMuted = muted; });
            if (isTeacher && ui.muteAllBtn) {
                ui.muteAllBtn.dataset.muted = muted ? '1' : '0';
                updateMuteAllButton();
            }
            if (!isTeacher) applyHostMute(muted);
        } else if (target != null) {
            const user = users.get(target);
            if (user) user.micMuted = muted;
            if (target === me.id) applyHostMute(muted);
        }

        if (msg.message) addChat(msg.sender || 'Ustoz', msg.message, 'system');
        renderPeople();
        refreshMediaTiles();
    }

    function applyHostMute(muted) {
        mutedByHost = muted;
        if (muted) stopMeter(me.id);
        else if (localAudio) startMeter(me.id, localStream, null);

        applyMicState();
        sendMicState();
        updateMicButton();

        const own = users.get(me.id);
        if (own) own.micMuted = muted || !micOn;

        toast(muted ? 'Ustoz mikrofonni o\'chirdi.' : 'Ustoz mikrofonni yoqdi.', muted ? 'warn' : '');
    }

    function onKick(msg) {
        if (Number(msg.target_user_id) !== me.id) return;
        leaving = true;
        toast('Ustoz sizni darsdan chiqardi.', 'error');
        teardown();
        setTimeout(() => { window.location.href = homeUrl; }, 1200);
    }

    /* ------------------------------------------------------------------
       AUDIO METER — real vaqtda yashil daraja
       ------------------------------------------------------------------ */
    function audioContext() {
        if (!audioCtxRef.ctx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            audioCtxRef.ctx = new Ctx();
            const resume = () => {
                if (audioCtxRef.ctx && audioCtxRef.ctx.state === 'suspended') {
                    audioCtxRef.ctx.resume().catch(() => {});
                }
            };
            document.addEventListener('click', resume);
            document.addEventListener('touchstart', resume, { passive: true });
        }
        if (audioCtxRef.ctx.state === 'suspended') audioCtxRef.ctx.resume().catch(() => {});
        return audioCtxRef.ctx;
    }

    /**
     * Ovoz darajasi analizatori.
     * mediaEl — ekranda ijro etilayotgan (unmuted) <video>; Chrome'da masofaviy
     * oqimni analiz qilish uchun elementga ulash kerak. Lokal oqimda null.
     */
    function startMeter(userId, stream, mediaEl) {
        stopMeter(userId);
        if (!stream) return;
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState === 'ended') return;

        const ctx = audioContext();
        if (!ctx) return;

        try {
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.6;
            source.connect(analyser);
            if (mediaEl) {
                try { source.connect(mediaEl); } catch (error) { /* allaqachon bog'langan */ }
            }

            const buffer = new Uint8Array(analyser.frequencyBinCount);
            const entry = { analyser, buffer, raf: 0, level: 0 };
            meters.set(userId, entry);

            const loop = () => {
                if (!meters.has(userId)) return;
                analyser.getByteFrequencyData(buffer);
                let sum = 0;
                for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
                const rms = Math.sqrt(sum / buffer.length) / 255;
                const level = Math.min(100, Math.round(Math.pow(rms, 0.6) * 170));
                entry.level = level;

                const user = users.get(userId);
                if (user) {
                    const speaking = level > 14;
                    const changed = user.speaking !== speaking;
                    user.speaking = speaking;
                    user.level = level;
                    paintMeter(userId, level);
                    if (changed) paintSpeaking(userId, speaking);
                }
                entry.raf = requestAnimationFrame(loop);
            };
            entry.raf = requestAnimationFrame(loop);
        } catch (error) {
            console.warn('[live-room] meter error', error);
        }
    }

    function startRemoteMeter(userId) {
        const id = Number(userId);
        const entry = peers.get(id);
        if (!entry) return;
        const user = users.get(id);
        if (user && user.micMuted) return;
        if (meters.has(id)) return;
        const mediaEl = ui.grid ? ui.grid.querySelector(`.tile[data-user-id="${id}"] video`) : null;
        startMeter(id, entry.remoteStream, mediaEl);
    }

    function stopMeter(userId) {
        const entry = meters.get(userId);
        if (entry) {
            cancelAnimationFrame(entry.raf);
            meters.delete(userId);
        }
        paintMeter(userId, 0);
        const user = users.get(userId);
        if (user && user.speaking) {
            user.speaking = false;
            user.level = 0;
            paintSpeaking(userId, false);
        }
    }

    function paintMeter(userId, level) {
        const width = `${Math.max(0, Math.min(100, level || 0))}%`;
        document.querySelectorAll(`[data-meter-for="${userId}"]`).forEach((bar) => {
            bar.style.width = width;
        });
        if (Number(userId) === teacherId && ui.pipMeter) ui.pipMeter.style.width = width;
    }

    function paintSpeaking(userId, speaking) {
        const row = ui.peopleList && ui.peopleList.querySelector(`.people-row[data-user-id="${userId}"]`);
        if (row) row.classList.toggle('is-speaking', speaking);

        const tile = ui.grid && ui.grid.querySelector(`.tile[data-user-id="${userId}"]`);
        if (tile) tile.classList.toggle('is-speaking', speaking);

        if (Number(userId) === teacherId && ui.pip) ui.pip.classList.toggle('is-speaking', speaking);

        if (ui.speakingChip) {
            const speaker = sortedUsers().find((user) => user.speaking);
            ui.speakingChip.hidden = !speaker;
            if (speaker) ui.speakingName.textContent = speaker.name;
        }

        if (Number(userId) === me.id && ui.micBtn) {
            ui.micBtn.classList.toggle('ctrl-btn--talking', speaking && micOn && !mutedByHost);
        }
    }

    /* ------------------------------------------------------------------
       RENDER — qatnashchilar paneli
       ------------------------------------------------------------------ */
    function renderPeople() {
        if (!ui.peopleList) return;
        const list = sortedUsers();
        ui.peopleCount.textContent = String(list.length);
        ui.countNum.textContent = String(list.length);
        ui.peopleList.innerHTML = '';

        if (!list.length) {
            ui.peopleList.innerHTML = '<div class="people-empty">Hozircha hech kim yo\'q</div>';
            return;
        }

        list.forEach((user) => {
            const row = document.createElement('div');
            row.className = 'people-row'
                + (user.id === me.id ? ' is-me' : '')
                + (user.speaking ? ' is-speaking' : '');
            row.dataset.userId = String(user.id);

            const canToggle = (isTeacher && user.id !== me.id) || (user.id === me.id && !mutedByHost);
            const micIcon = user.micMuted ? ICON.micOff : ICON.micOn;

            row.innerHTML = `
                <div class="people-avatar">${esc(initials(user.name))}</div>
                <div class="people-info">
                    <div class="people-name">
                        <span class="people-name-text">${esc(user.name)}</span>
                        ${user.id === me.id ? '<span class="tag">Siz</span>' : (user.role === 'teacher' ? '<span class="tag">Host</span>' : '')}
                    </div>
                    <div class="people-sub">
                        <div class="meter"><div class="meter__fill" data-meter-for="${user.id}" style="width:${user.speaking ? user.level : 0}%"></div></div>
                    </div>
                </div>
                <div class="people-actions">
                    <button type="button" class="tile-btn${user.micMuted ? ' is-muted' : ''}" data-mic="${user.id}" ${canToggle ? '' : 'disabled'} title="${user.micMuted ? 'Mikrofonni yoqish' : 'Mikrofonni o\'chirish'}">${micIcon}</button>
                    ${isTeacher && user.id !== me.id
                        ? `<button type="button" class="tile-btn" data-kick="${user.id}" title="Darsdan chiqarish">${ICON.kick}</button>`
                        : ''}
                </div>
            `;

            const micBtn = row.querySelector('[data-mic]');
            if (micBtn) {
                micBtn.addEventListener('click', () => {
                    if (user.id === me.id) toggleMic();
                    else sendSignal(user.micMuted ? 'unmute_user' : 'mute_user', { target_user_id: user.id });
                });
            }
            const kickBtn = row.querySelector('[data-kick]');
            if (kickBtn) {
                kickBtn.addEventListener('click', () => {
                    if (window.confirm(`${user.name} ni darsdan chiqarishni tasdiqlaysizmi?`)) {
                        sendSignal('kick_user', { target_user_id: user.id });
                    }
                });
            }

            ui.peopleList.appendChild(row);
        });
    }

    /* ------------------------------------------------------------------
       RENDER — grid (qora fon ustidagi to'r)
       ------------------------------------------------------------------ */
    function gridUsers() {
        // Ustoz doim PiP'da turadi — grid'da faqat o'quvchilar (o'quvchi bo'lsam, o'zim ham)
        return sortedUsers().filter((user) => !isHostUser(user.id) && user.role !== 'teacher');
    }

    function columnCount(total) {
        if (total <= 1) return 1;
        if (total <= 4) return 2;
        if (total <= 9) return 3;
        if (total <= 16) return 4;
        return Math.ceil(Math.sqrt(total));
    }

    function renderGrid() {
        if (!ui.grid) return;
        const list = gridUsers();
        const isMaxView = maximizedId != null && list.some((u) => u.id === maximizedId);
        const cols = isMaxView ? 1 : columnCount(list.length);

        ui.grid.style.setProperty('--cols', String(cols));
        ui.grid.classList.toggle('is-single', isMaxView);
        ui.grid.innerHTML = '';

        if (!list.length) {
            ui.grid.hidden = true;
            ui.hint.hidden = !!screenOwnerId;
            ui.hintText.textContent = localStream
                ? 'Boshqa qatnashchilar qo\'shilganda ular shu qora fonda to\'r (grid) shaklida chiqadi.'
                : 'Kamera va mikrofon ruxsatini bering — qatnashchilar shu yerda to\'r (grid) shaklida chiqadi.';
            renderPip();
            return;
        }

        ui.grid.hidden = false;
        ui.hint.hidden = true;

        list.forEach((user) => {
            const isMax = maximizedId === user.id;
            const tile = document.createElement('div');
            tile.className = 'tile' + (isMax ? ' is-maximized' : '') + (user.speaking ? ' is-speaking' : '');
            tile.dataset.userId = String(user.id);
            tile.innerHTML = `
                <video autoplay playsinline ${user.id === me.id ? 'muted' : ''}></video>
                <div class="tile__placeholder" hidden><span>${esc(initials(user.name))}</span></div>
                <div class="tile__label">
                    <span class="mic-badge${user.micMuted ? ' is-muted' : ''}" data-badge-for="${user.id}">${user.micMuted ? ICON.micOff : ICON.micOn}</span>
                    <span class="tile__name">${esc(user.name)}${user.id === me.id ? ' (Siz)' : ''}</span>
                    ${user.role === 'teacher' ? '<span class="tile__role">Host</span>' : ''}
                </div>
                <div class="tile__toolbar">
                    <button type="button" class="tile-btn" data-max="${user.id}" title="${isMax ? 'Kichraytirish' : 'Kattalashtirish'}">${isMax ? ICON.min : ICON.max}</button>
                </div>
                <div class="tile__meter meter"><div class="meter__fill" data-meter-for="${user.id}" style="width:${user.speaking ? user.level : 0}%"></div></div>
            `;
            tile.querySelector('[data-max]').addEventListener('click', (event) => {
                event.stopPropagation();
                toggleMaximize(user.id);
            });
            ui.grid.appendChild(tile);
        });

        refreshMediaTiles();
    }

    function refreshMediaTiles() {
        if (ui.grid) {
            ui.grid.querySelectorAll('.tile').forEach((tile) => {
                const id = Number(tile.dataset.userId);
                const user = users.get(id);
                if (!user) return;
                bindVideo(tile.querySelector('video'), streamFor(id), tile.querySelector('.tile__placeholder'));
                const badge = tile.querySelector(`[data-badge-for="${id}"]`);
                if (badge) {
                    badge.classList.toggle('is-muted', user.micMuted);
                    badge.innerHTML = user.micMuted ? ICON.micOff : ICON.micOn;
                }
                paintMeter(id, user.speaking ? user.level : 0);
            });
        }
        renderPip();
        renderScreen();
    }

    function bindVideo(video, stream, placeholder) {
        if (!video) return;
        const track = stream ? stream.getVideoTracks().find((t) => t.readyState === 'live') : null;
        if (!track) {
            video.classList.add('is-hidden');
            if (video.srcObject) video.srcObject = null;
            if (placeholder) placeholder.hidden = false;
            return;
        }
        if (video.srcObject !== stream) {
            video.srcObject = stream;
            video.play().catch(() => {});
        }
        video.classList.remove('is-hidden');
        if (placeholder) placeholder.hidden = true;
    }

    /* ------------------------------------------------------------------
       USTOZ PiP — har doim ustki qatlamda
       ------------------------------------------------------------------ */
    function renderPip() {
        if (!ui.pip) return;
        const teacher = teacherId != null && teacherId !== me.id ? users.get(teacherId) : null;
        if (!teacher) {
            ui.pip.hidden = true;
            ui.stage.classList.remove('has-pip');
            return;
        }

        ui.pip.hidden = false;
        ui.stage.classList.add('has-pip');
        ui.pipName.textContent = teacher.name;
        ui.pipInitials.textContent = initials(teacher.name);
        ui.pipMic.classList.toggle('is-muted', teacher.micMuted);
        ui.pipMic.innerHTML = teacher.micMuted ? ICON.micOff : ICON.micOn;
        ui.pip.classList.toggle('is-speaking', !!teacher.speaking);
        ui.pip.classList.toggle('is-maximized', maximizedId === teacher.id);
        bindVideo(ui.pipVideo, streamFor(teacher.id), ui.pipPlaceholder);
        paintMeter(teacher.id, teacher.speaking ? teacher.level : 0);
    }

    /* ------------------------------------------------------------------
       KATTALASHTIRISH / KICHRAYTIRISH
       ------------------------------------------------------------------ */
    function toggleMaximize(userId) {
        const id = Number(userId);
        maximizedId = maximizedId === id ? null : id;
        renderGrid();
        toast(maximizedId != null ? 'Oyna kattalashtirildi' : 'Oyna kichraytirildi');
    }

    /* ------------------------------------------------------------------
       EKRAN REJIMI
       ------------------------------------------------------------------ */
    function renderScreen() {
        if (!ui.stage) return;
        const active = screenOwnerId != null;
        ui.stage.classList.toggle('screen-mode', active);
        ui.stage.classList.toggle('dock-visible', active && dockVisible);
        ui.screenChip.hidden = !active;

        if (!active) {
            if (ui.screenVideo.srcObject) ui.screenVideo.srcObject = null;
            if (ui.shareBtn) {
                ui.shareBtn.classList.remove('ctrl-btn--on');
                ui.shareText.textContent = 'Ekranni uzatish';
            }
            return;
        }

        let stream = null;
        if (screenOwnerId === me.id) {
            stream = screenStream;
        } else {
            const entry = peers.get(screenOwnerId);
            if (entry && entry.remoteScreenTrack) stream = new MediaStream([entry.remoteScreenTrack]);
        }

        if (stream && ui.screenVideo.srcObject !== stream) {
            ui.screenVideo.srcObject = stream;
            ui.screenVideo.play().catch(() => {});
        }

        const owner = users.get(screenOwnerId);
        if (owner) ui.screenChip.textContent = `${owner.name} ekranni uzatmoqda`;
    }

    function onScreenStart(msg) {
        const id = Number(msg.screen_owner_id != null ? msg.screen_owner_id : msg.sender_id);
        if (!id) return;
        screenOwnerId = id;
        dockVisible = false;
        renderScreen();
        addChat('Tizim', msg.message || `${msg.sender} ekran uzatishni boshladi.`, 'system');
    }

    function onScreenStop(msg) {
        const id = Number(msg.screen_owner_id != null ? msg.screen_owner_id : msg.sender_id);
        if (screenOwnerId != null && id && id !== screenOwnerId) return;
        screenOwnerId = null;
        dockVisible = false;
        const entry = peers.get(id);
        if (entry) entry.remoteScreenTrack = null;
        renderScreen();
        addChat('Tizim', msg.message || `${msg.sender || 'Qatnashchi'} ekran uzatishni to\'xtatdi.`, 'system');
    }

    async function toggleShareScreen() {
        if (!isTeacher) return;
        if (screenStream) {
            await stopShareScreen();
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            toast('Brauzer ekran uzatishni qo\'llab-quvvatlamaydi.', 'error');
            return;
        }

        let display;
        try {
            display = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 24, max: 30 } },
                audio: false,
            });
        } catch (error) {
            if (error && error.name === 'NotAllowedError') toast('Ekran uzatish bekor qilindi.', 'warn');
            else toast('Ekran uzatishda xatolik yuz berdi.', 'error');
            return;
        }

        const track = display.getVideoTracks()[0];
        if (!track) return;

        screenStream = display;
        screenOwnerId = me.id;
        dockVisible = false;
        track.onended = () => { stopShareScreen(); };

        peers.forEach((entry) => {
            try { entry.senders.screen = entry.pc.addTrack(track, display); } catch (error) { /* noop */ }
        });

        sendSignal('screen-share-start', { screen_owner_id: me.id });
        renderScreen();
        if (ui.shareBtn) {
            ui.shareBtn.classList.add('ctrl-btn--on');
            ui.shareText.textContent = 'Uzatishni to\'xtatish';
        }
        addChat('Tizim', 'Ekran uzatish boshlandi.', 'system');
    }

    async function stopShareScreen() {
        if (!screenStream) return;

        peers.forEach((entry) => {
            if (entry.senders.screen) {
                try { entry.pc.removeTrack(entry.senders.screen); } catch (error) { /* noop */ }
                entry.senders.screen = null;
            }
        });
        screenStream.getTracks().forEach((track) => {
            track.onended = null;
            track.stop();
        });
        screenStream = null;
        screenOwnerId = null;
        dockVisible = false;

        sendSignal('screen-share-stop', { screen_owner_id: me.id });
        renderScreen();
        addChat('Tizim', 'Ekran uzatish to\'xtatildi.', 'system');
    }

    /* ------------------------------------------------------------------
       CHAT
       ------------------------------------------------------------------ */
    function addChat(sender, message, kind) {
        if (!ui.chat || message == null || message === '') return;
        const item = document.createElement('div');
        item.className = 'chat-item' + (kind ? ` chat-item--${kind}` : '');
        const label = kind === 'me' ? 'Siz' : (sender || 'Tizim');
        item.innerHTML = `<div class="chat-item__meta">${esc(label)}</div><div class="chat-item__body">${esc(message)}</div>`;
        ui.chat.appendChild(item);
        ui.chat.scrollTop = ui.chat.scrollHeight;
    }

    function submitChat(event) {
        if (event) event.preventDefault();
        const text = (ui.chatInput.value || '').trim();
        if (!text) return;
        if (!sendSignal('chat-message', { message: text })) {
            toast('Ulanish hali tayyor emas.', 'warn');
            return;
        }
        addChat(me.name, text, 'me');
        ui.chatInput.value = '';
    }

    /* ------------------------------------------------------------------
       UMUMIY YANGILASH
       ------------------------------------------------------------------ */
    function refreshAll() {
        renderPeople();
        renderGrid();
        renderPip();
        renderScreen();
        updateMicButton();
    }

    function updateMuteAllButton() {
        if (!ui.muteAllBtn) return;
        const muted = ui.muteAllBtn.dataset.muted === '1';
        ui.muteAllText.textContent = muted ? 'Hammasini yoqish' : 'Hammasini o\'chirish';
        ui.muteAllBtn.classList.toggle('ctrl-btn--muted', muted);
    }

    /* ------------------------------------------------------------------
       HODISALAR
       ------------------------------------------------------------------ */
    function bindEvents() {
        if (ui.micBtn) ui.micBtn.addEventListener('click', toggleMic);
        if (ui.shareBtn) ui.shareBtn.addEventListener('click', toggleShareScreen);

        if (ui.muteAllBtn) {
            ui.muteAllBtn.addEventListener('click', () => {
                const muted = ui.muteAllBtn.dataset.muted === '1';
                if (!sendSignal(muted ? 'unmute_all' : 'mute_all')) toast('Ulanish tayyor emas.', 'warn');
            });
        }

        if (ui.chatForm) ui.chatForm.addEventListener('submit', submitChat);

        if (ui.leaveBtn) {
            ui.leaveBtn.addEventListener('click', () => {
                teardown();
                window.location.href = isTeacher ? dashboardUrl : homeUrl;
            });
        }

        if (ui.fullscreenBtn) {
            ui.fullscreenBtn.addEventListener('click', async () => {
                try {
                    if (document.fullscreenElement) await document.exitFullscreen();
                    else await ui.stage.requestFullscreen();
                } catch (error) { console.warn('[live-room] fullscreen', error); }
            });
        }

        if (ui.copyBtn) {
            ui.copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(window.location.href);
                    toast('Dars havolasi nusxalandi.');
                } catch (error) {
                    window.prompt('Havolani nusxalang:', window.location.href);
                }
            });
        }

        // Ekran rejimida bo'sh joyga bosganda kichik oynachani ko'rsatish/yashirish
        if (ui.stage) {
            ui.stage.addEventListener('click', (event) => {
                if (!ui.stage.classList.contains('screen-mode')) return;
                if (event.target.closest('.pip') || event.target.closest('.stage__dock') || event.target.closest('.stage__topbar')) return;
                dockVisible = !dockVisible;
                ui.stage.classList.toggle('dock-visible', dockVisible);
            });
        }

        // PiP tugmalari
        if (ui.pip) {
            const toggleBtn = ui.pip.querySelector('[data-pip-toggle]');
            const dockBtn = ui.pip.querySelector('[data-pip-dock]');
            if (toggleBtn) {
                toggleBtn.innerHTML = ICON.max;
                toggleBtn.addEventListener('click', () => {
                    if (teacherId != null) toggleMaximize(teacherId);
                });
            }
            if (dockBtn) {
                dockBtn.innerHTML = ICON.dock;
                dockBtn.addEventListener('click', () => {
                    maximizedId = null;
                    dockVisible = true;
                    ui.stage.classList.add('dock-visible');
                    renderGrid();
                });
            }
        }

        window.addEventListener('beforeunload', () => { leaving = true; teardown(); });

        // Autoplay: birinchi bosishda videolarni ishga tushirish
        const unlock = () => {
            [ui.screenVideo, ui.pipVideo].forEach((video) => {
                if (video && video.srcObject) video.play().catch(() => {});
            });
            if (audioCtxRef.ctx && audioCtxRef.ctx.state === 'suspended') audioCtxRef.ctx.resume().catch(() => {});
        };
        document.addEventListener('click', unlock);
        document.addEventListener('touchstart', unlock, { passive: true });
    }

    function teardown() {
        leaving = true;
        if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
            localStream = null;
        }
        if (screenStream) {
            screenStream.getTracks().forEach((track) => { track.onended = null; track.stop(); });
            screenStream = null;
        }
        [...peers.keys()].forEach(destroyPeer);
        try { if (socket && socket.readyState === WebSocket.OPEN) socket.close(); } catch (error) { /* noop */ }
    }

    /* ------------------------------------------------------------------
       INIT
       ------------------------------------------------------------------ */
    async function init() {
        if (!me.id || !Number(CFG.lessonId)) {
            toast('Dars ma\'lumotlari topilmadi.', 'error');
            return;
        }

        const own = upsertUser(me.id, { name: me.name, role: me.role });
        own.micMuted = !micOn || mutedByHost;
        if (teacherId && teacherId !== me.id) upsertUser(teacherId, { name: CFG.teacherName, role: 'teacher' });

        if (isTeacher) {
            if (ui.shareBtn) ui.shareBtn.hidden = false;
            if (ui.muteAllBtn) ui.muteAllBtn.hidden = false;
        }
        if (ui.badgeText) ui.badgeText.textContent = CFG.isLive || isTeacher ? 'Jonli' : 'Kutilyapti';

        updateMicButton();
        updateMuteAllButton();
        bindEvents();
        refreshAll();

        connect();
        await startLocalMedia();
        if (joined) {
            users.forEach((user) => {
                if (user.id !== me.id) connectPeer(user.id, me.id < user.id);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
