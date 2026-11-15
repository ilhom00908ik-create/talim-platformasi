/* ==========================================================================
   Jonli dars xonasi — WebSocket signaling + WebRTC mesh + UI mantiq
   --------------------------------------------------------------------------
   Holat:
     users  — xonadagi qatnashchilar (o'zim + boshqalar)
     peers  — har bir masofaviy qatnashchi uchun RTCPeerConnection
     meters — har bir foydalanuvchi uchun AudioContext analizatori (yashil bar)

   Ko'rinish:
     • Ekran uzatilmasa  -> qora fonda qatnashchilar to'ri (grid)
     • Ekran uzatilsa    -> katta ekran + ustoz PiP + pastda qatnashchilar strip
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
    const wsPath = CFG.wsPath || ('/ws/live/' + Number(CFG.lessonId || 0) + '/');
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
        app: $('roomApp'),
        stage: $('stageView'),
        grid: $('videoGrid'),
        screenLayer: $('screenLayer'),
        screenVideo: $('screenVideo'),
        screenEmpty: $('screenEmpty'),
        screenChip: $('screenChip'),
        screenChipText: $('screenChipText'),
        hint: $('stageHint'),
        hintText: $('stageHintText'),
        strip: $('stageStrip'),
        stripList: $('stripList'),
        pip: $('pipWindow'),
        pipVideo: $('pipVideo'),
        pipPlaceholder: $('pipPlaceholder'),
        pipPhoto: $('pipPhoto'),
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
        micIcon: $('micBtnIcon'),
        micText: $('micBtnText'),
        myLevel: $('myLevel'),
        camBtn: $('toggleCamBtn'),
        camText: $('camBtnText'),
        shareBtn: $('shareScreenBtn'),
        shareText: $('shareScreenText'),
        muteAllBtn: $('muteAllBtn'),
        muteAllText: $('muteAllText'),
        fullscreenBtn: $('toggleFullscreenBtn'),
        leaveBtn: $('leaveRoomBtn'),
        peopleToggle: $('togglePeopleBtn'),
        side: $('roomSide'),
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
        kick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>',
        screenStop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
    };

    /* ------------------------------------------------------------- holat */
    const users = new Map();
    const peers = new Map();
    const meters = new Map();
    const pendingCandidates = new Map();
    const negotiateBusy = new Set();
    const speakingTimers = new Map();

    let socket = null;
    let joined = false;
    let leaving = false;
    let reconnectAttempts = 0;

    let localStream = null;
    let localAudio = null;
    let localVideo = null;
    let micOn = true;
    let camOn = true;
    let mutedByHost = false;

    let screenStream = null;
    let screenOwnerId = null;
    let maximizedId = null;
    let reportedSpeaking = false;

    const audioCtxRef = { ctx: null };

    /* ------------------------------------------------------ yordamchilar */
    const esc = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map((part) => part.charAt(0).toUpperCase()).join('') || '?';
    }

    function shortName(name) {
        const parts = String(name || '').trim().split(/\s+/);
        if (parts.length < 2) return parts[0] || '?';
        return parts[0] + ' ' + (parts[1].charAt(0) || '').toUpperCase() + '.';
    }

    const isHostUser = (id) => teacherId != null && Number(id) === teacherId;
    const isSelf = (id) => Number(id) === me.id;

    function toast(message, kind) {
        if (!ui.toasts) return;
        const last = ui.toasts.lastElementChild;
        if (last && last.textContent === message) return;
        const node = document.createElement('div');
        node.className = 'toast' + (kind ? ' toast--' + kind : '');
        node.textContent = message;
        ui.toasts.appendChild(node);
        while (ui.toasts.children.length > 3) ui.toasts.firstElementChild.remove();
        setTimeout(() => node.remove(), 4200);
    }

    function wsSend(payload) {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(payload));
        return true;
    }

    const sendSignal = (type, extra) => wsSend(Object.assign({ type: type }, extra || {}));

    function upsertUser(id, data) {
        id = Number(id);
        if (!id) return null;
        let user = users.get(id);
        if (!user) {
            user = {
                id: id,
                name: (data && data.name) || ('Qatnashchi ' + id),
                role: isHostUser(id) ? 'teacher' : ((data && data.role) || 'student'),
                micMuted: false,
                speaking: false,
                noCam: false,
                level: 0,
                hasVideo: false,
            };
            users.set(id, user);
        }
        if (data) {
            if (data.name) user.name = data.name;
            if (data.role) user.role = data.role;
            if (isHostUser(id)) user.role = 'teacher';
            if (typeof data.mic_muted === 'boolean') user.micMuted = data.mic_muted;
            if (typeof data.no_cam === 'boolean') user.noCam = data.no_cam;
            if (typeof data.speaking === 'boolean') user.speaking = data.speaking;
        }
        return user;
    }

    function sortedUsers() {
        return [...users.values()].sort((a, b) => {
            const ah = isHostUser(a.id) ? 0 : 1;
            const bh = isHostUser(b.id) ? 0 : 1;
            if (ah !== bh) return ah - bh;
            if (a.id === me.id) return -1;
            if (b.id === me.id) return 1;
            return a.name.localeCompare(b.name, 'uz');
        });
    }

    function streamFor(id) {
        if (Number(id) === me.id) return localStream;
        const entry = peers.get(Number(id));
        return entry ? entry.remoteStream : null;
    }

    function hasLiveVideo(id) {
        const stream = streamFor(id);
        if (!stream) return false;
        const track = stream.getVideoTracks()[0];
        return Boolean(track && track.readyState === 'live');
    }

    /* ==================================================================
       WEBSOCKET
       ================================================================== */
    function connect() {
        if (leaving) return;
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        try {
            socket = new WebSocket(proto + '://' + window.location.host + wsPath);
        } catch (error) {
            console.error('[live-room] socket create failed', error);
            setTimeout(connect, 2500);
            return;
        }

        socket.addEventListener('open', () => {
            reconnectAttempts = 0;
            wsSend({ type: 'join' });
            if (localStream) sendMicState();
        });

        socket.addEventListener('close', () => {
            joined = false;
            if (leaving) return;
            reconnectAttempts += 1;
            const delay = Math.min(8000, 1500 * reconnectAttempts);
            toast('Ulanish uzildi, qayta ulanmoqda…', 'warn');
            setTimeout(connect, delay);
        });

        socket.addEventListener('error', () => console.warn('[live-room] WS error'));

        socket.addEventListener('message', (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (error) { return; }
            if (data && data.type) {
                Promise.resolve()
                    .then(() => onMessage(data))
                    .catch((error) => console.error('[live-room]', data.type, error));
            }
        });
    }

    function onMessage(msg) {
        switch (msg.type) {
            case 'room-state': return onRoomState(msg);
            case 'presence': return onPresence(msg);
            case 'chat-message': return addChat(msg.sender, msg.message, msg.sender_id === me.id ? 'me' : '');
            case 'mic-state': return onRemoteMicState(msg.sender_id, !!msg.muted);
            case 'cam-state': return onRemoteCamState(msg.sender_id, !!msg.enabled);
            case 'speaking': return onRemoteSpeaking(msg.sender_id, !!msg.speaking);
            case 'mute_user':
            case 'unmute_user':
            case 'mute_all':
            case 'unmute_all': return onMuteCommand(msg);
            case 'kick_user': return onKick(msg);
            case 'screen-share-start': return onScreenStart(msg);
            case 'screen-share-stop': return onScreenStop(msg);
            case 'lesson-ended':
                if (ui.badgeText) ui.badgeText.textContent = 'Yakunlandi';
                if (ui.badge) ui.badge.classList.remove('pill--live');
                return addChat('Tizim', msg.message || 'Dars yakunlandi.', 'system');
            case 'webrtc-offer':
            case 'webrtc-answer':
            case 'webrtc-candidate': return onSignal(msg);
            default: return undefined;
        }
    }

    function mergeParticipant(p) {
        if (!p) return;
        const id = Number(p.id);
        if (!id) return;
        upsertUser(id, {
            name: p.name,
            role: p.role,
            mic_muted: typeof p.mic_muted === 'boolean' ? p.mic_muted : false,
            no_cam: typeof p.no_cam === 'boolean' ? p.no_cam : false,
            speaking: typeof p.speaking === 'boolean' ? p.speaking : false,
        });
    }

    function onRoomState(msg) {
        const first = !joined;
        joined = true;

        if (msg.mic_muted_by_host) {
            mutedByHost = true;
            micOn = false;
            applyMicState();
        }

        upsertUser(me.id, { name: msg.user_name || me.name, role: msg.role || me.role });

        // Serverdan kelgan ro'yxat — xonaning yagona haqiqati
        const present = new Set([me.id]);
        (msg.participants || []).forEach((p) => {
            const id = Number(p.id);
            if (!id) return;
            present.add(id);
            mergeParticipant(p);
            if (id !== me.id && p.mic_muted) stopMeter(id);
        });

        // Ro'yxatda yo'q bo'lganlarni olib tashlaymiz (qayta ulanishda eskilar qolmasin)
        [...users.keys()].forEach((id) => {
            if (!present.has(id)) {
                users.delete(id);
                destroyPeer(id);
                if (screenOwnerId === id) screenOwnerId = null;
                if (maximizedId === id) maximizedId = null;
            }
        });

        (msg.chat_history || []).forEach((item) => {
            addChat(item.sender, item.message, item.sender_id === me.id ? 'me' : '');
        });

        if (msg.screen_owner_id) {
            screenOwnerId = Number(msg.screen_owner_id);
        }

        refreshAll();

        if (first) {
            present.forEach((id) => {
                if (id !== me.id) connectPeer(id, me.id < id);
            });
        } else {
            // Qayta ulanish: barcha peerlarni tozalab, yangidan quramiz
            [...peers.keys()].forEach(destroyPeer);
            present.forEach((id) => {
                if (id !== me.id) connectPeer(id, me.id < id);
            });
        }

        sendMicState();
        if (localVideo) sendCamState();
    }

    function onPresence(msg) {
        const id = Number(msg.sender_id);
        if (!id || id === me.id) return;

        if (msg.left) {
            users.delete(id);
            destroyPeer(id);
            if (screenOwnerId === id) { screenOwnerId = null; }
            if (maximizedId === id) maximizedId = null;
            refreshAll();
            return;
        }

        upsertUser(id, {
            name: msg.name || msg.sender,
            role: msg.role,
            mic_muted: typeof msg.mic_muted === 'boolean' ? msg.mic_muted : undefined,
            no_cam: typeof msg.no_cam === 'boolean' ? msg.no_cam : undefined,
        });
        refreshAll();

        // Kim kimdan oldin kirganidan qat'i nazar — faqat bitta tomon offer yuboradi
        connectPeer(id, me.id < id);
    }

    function sendMicState() {
        sendSignal('mic-state', { muted: !micOn || mutedByHost });
    }

    function sendCamState() {
        sendSignal('cam-state', { enabled: camOn });
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
            id: id,
            pc: pc,
            polite: me.id > id,
            makingOffer: false,
            ignoreOffer: false,
            remoteStream: new MediaStream(),
            remoteScreenTrack: null,
            senders: { audio: null, video: null, screen: null },
            hasOfferStarted: false,
        };
        peers.set(id, entry);

        pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            sendSignal('webrtc-candidate', { target_user_id: id, candidate: event.candidate.toJSON() });
        };

        pc.onnegotiationneeded = () => {
            if (!entry.hasOfferStarted) return;
            negotiate(entry).catch((error) => console.warn('[live-room] negotiate', error));
        };

        pc.ontrack = (event) => {
            const track = event.track;
            const screenTrack = track.kind === 'video' && isScreenLabel(track.label);

            if (screenTrack) {
                // Ekran uzatish egasi screen-share signali orqali aniqlanadi:
                // faqat egasi ekran eyishga ruxsat oladi, boshqa video track'lar
                // kamera sifatida qabul qilinadi (takroriy "ekran" muammosi yo'q).
                const user = users.get(id);
                const isOwner = screenOwnerId === id || (!screenOwnerId && isTeacherTrackOwner(id));
                if (screenOwnerId === null) screenOwnerId = id;
                if (isOwner || !user) {
                    entry.remoteScreenTrack = track;
                    track.onmute = renderScreen;
                    track.onunmute = renderScreen;
                    track.onended = () => {
                        if (entry.remoteScreenTrack === track) entry.remoteScreenTrack = null;
                        renderScreen();
                    };
                    renderScreen();
                }
                if (track.kind === 'video' && !entry.remoteStream.getTracks().length) {
                    // Ba'zi brauzerlarda screen track label bo'lmasligi mumkin —
                    // u holda ekranni ko'rsatish uchun stream'ga ham qo'shamiz.
                    entry.remoteStream.addTrack(track);
                }
            } else if (!entry.remoteStream.getTracks().some((item) => item.id === track.id)) {
                entry.remoteStream.addTrack(track);
                track.onunmute = () => { markHasVideo(id); refreshMediaTiles(); };
                track.onended = () => {
                    entry.remoteStream.removeTrack(track);
                    markHasVideo(id);
                    refreshMediaTiles();
                };
                if (track.kind === 'video') markHasVideo(id);
            }

            upsertUser(id, null);
            // C0H: masofaviy ovoz darajasi (yashil bar) real vaqtda ishlashi uchun
            // har bir yangi audio track'da analyserni qayta quramiz.
            if (track.kind === 'audio' && !entry.remoteStream.getAudioTracks().includes(track)) {
                entry.remoteStream.addTrack(track);
            }
            refreshAll();
            if (track.kind === 'audio') {
                const user = users.get(id);
                if (!user || !user.micMuted) startRemoteMeter(id, true);
            }
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed') {
                try { pc.restartIce(); } catch (error) { /* ignore */ }
            }
        };

        if (localStream) addLocalTracks(entry);
        return entry;
    }

    // Ekran egasi ustoz bo'lsa (yoki noma'lum bo'lsa) — ustoz ekranini ko'rsatamiz
    function isTeacherTrackOwner(id) {
        return isHostUser(id);
    }

    function markHasVideo(id) {
        id = Number(id);
        if (isSelf(id)) {
            const own = users.get(id);
            if (own) {
                own.hasVideo = Boolean(localVideo && camOn);
                own.noCam = !camOn;
            }
            return;
        }
        const entry = peers.get(id);
        const user = users.get(id);
        if (!user) return;
        const stream = entry ? entry.remoteStream : null;
        const live = Boolean(stream && stream.getVideoTracks().some((t) => t.readyState === 'live' && !isScreenLabel(t.label)));
        user.hasVideo = live;
        if (!live) user.noCam = true;
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
        if (startNegotiation && !entry.hasOfferStarted) {
            entry.hasOfferStarted = true;
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
        if (localVideo && !entry.senders.video && entry.senders.video !== false) {
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
            entry.hasOfferStarted = true;
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
        id = Number(id);
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
        clearSpeakingTimer(id);
    }

    /* ------------------------------------------------------------------
       LOKAL MEDIA
       ------------------------------------------------------------------ */
    async function startLocalMedia() {
        if (localStream) return localStream;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            toast('Brauzer kamera/mikrofonni qo‘llab-quvvatlamaydi.', 'error');
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
                camOn = false;
                toast('Kamera mavjud emas — faqat mikrofon bilan davom etamiz.', 'warn');
            } catch (audioError) {
                console.error('[live-room] media denied', audioError);
                toast('Kamera va mikrofon ruxsati berilmadi.', 'error');
                return null;
            }
        }

        localAudio = localStream.getAudioTracks()[0] || null;
        localVideo = localStream.getVideoTracks()[0] || null;
        if (localAudio) localAudio.enabled = micOn && !mutedByHost;
        if (localVideo) localVideo.enabled = camOn;

        const own = upsertUser(me.id, { name: me.name, role: me.role });
        own.micMuted = !micOn || mutedByHost;
        own.noCam = !camOn;
        own.hasVideo = Boolean(localVideo && camOn);

        updateMicButton();
        updateCamButton();
        refreshAll();
        peers.forEach((entry) => addLocalTracks(entry));
        peers.forEach((entry) => {
            if (!entry.hasOfferStarted && pcHasTracks(entry)) {
                entry.hasOfferStarted = true;
                negotiate(entry).catch(() => {});
            }
        });

        if (localAudio && !own.micMuted) startMeter(me.id, localStream);
        sendMicState();
        sendCamState();
        return localStream;
    }

    function applyMicState() {
        if (localAudio) localAudio.enabled = micOn && !mutedByHost;
    }

    function toggleMic() {
        if (mutedByHost) {
            toast('Mikrofon ustoz tomonidan o‘chirilgan.', 'warn');
            return;
        }
        micOn = !micOn;
        applyMicState();
        sendMicState();

        const own = upsertUser(me.id, null);
        if (own) own.micMuted = !micOn;

        if (!localAudio) {
            startLocalMedia().catch(() => {});
        } else if (micOn) {
            startMeter(me.id, localStream);
        } else {
            stopMeter(me.id);
        }

        updateMicButton();
        renderPeople();
        refreshMediaTiles();
    }

    function updateMicButton() {
        if (!ui.micBtn) return;
        const on = micOn && !mutedByHost;
        if (ui.micText) ui.micText.textContent = on ? 'Mikrofon yoniq' : 'Mikrofon o‘chirilgan';
        if (ui.micIcon) ui.micIcon.innerHTML = on ? ICON.micOn : ICON.micOff;
        ui.micBtn.classList.toggle('ctrl-btn--on', on);
        ui.micBtn.classList.toggle('ctrl-btn--muted', !on);
        ui.micBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        ui.micBtn.title = on ? 'Mikrofonni o‘chirish' : 'Mikrofonni yoqish';
    }

    function toggleCamera() {
        if (!localVideo) {
            toast('Kamera topilmadi.', 'warn');
            return;
        }
        camOn = !camOn;
        localVideo.enabled = camOn;
        const own = upsertUser(me.id, null);
        if (own) {
            own.noCam = !camOn;
            own.hasVideo = camOn;
        }
        sendCamState();
        updateCamButton();
        refreshAll();
    }

    function updateCamButton() {
        if (!ui.camBtn) return;
        if (ui.camText) ui.camText.textContent = camOn ? 'Kamera yoniq' : 'Kamera o‘chirilgan';
        ui.camBtn.classList.toggle('ctrl-btn--on', camOn);
        ui.camBtn.classList.toggle('ctrl-btn--muted', !camOn);
        ui.camBtn.setAttribute('aria-pressed', camOn ? 'true' : 'false');
    }

    /* ------------------------------------------------------------------
       MUTE / KAMERA / GAPIRISH — masofaviy holat
       ------------------------------------------------------------------ */
    function onRemoteMicState(senderId, muted) {
        const user = users.get(Number(senderId));
        if (!user) return;
        user.micMuted = muted;
        if (muted) {
            stopMeter(user.id);
            setSpeaking(user.id, false);
        } else {
            startRemoteMeter(user.id, true);
        }
        renderPeople();
        refreshMediaTiles();
    }

    function onRemoteCamState(senderId, enabled) {
        const user = users.get(Number(senderId));
        if (!user) return;
        user.noCam = !enabled;
        renderPeople();
        refreshMediaTiles();
    }

    function onRemoteSpeaking(senderId, speaking) {
        const id = Number(senderId);
        if (!users.has(id)) return;
        setSpeaking(id, speaking);
    }

    function onMuteCommand(msg) {
        const target = msg.target_user_id == null ? null : Number(msg.target_user_id);
        const muted = msg.muted != null ? !!msg.muted
            : (msg.type === 'mute_all' || msg.type === 'mute_user');

        if (msg.type === 'mute_all' || msg.type === 'unmute_all') {
            users.forEach((user) => {
                if (user.id !== me.id && !isHostUser(user.id)) {
                    user.micMuted = muted;
                    if (muted) stopMeter(user.id);
                }
            });
            if (isTeacher && ui.muteAllBtn) {
                ui.muteAllBtn.dataset.muted = muted ? '1' : '0';
                updateMuteAllButton();
            }
            if (!isTeacher) applyHostMute(muted);
        } else if (target != null) {
            const user = users.get(target);
            if (user) {
                user.micMuted = muted;
                if (muted) stopMeter(target);
            }
            if (target === me.id) applyHostMute(muted);
        }

        if (msg.message) addChat(msg.sender || 'Ustoz', msg.message, 'system');
        renderPeople();
        refreshMediaTiles();
    }

    function applyHostMute(muted) {
        mutedByHost = muted;
        // Ustoz "yoqish" buyrug'i bersa, foydalanuvchining o'z tanlovi qayta tiklanadi
        if (!muted) micOn = true;

        applyMicState();
        sendMicState();
        updateMicButton();

        const own = users.get(me.id);
        if (own) own.micMuted = muted || !micOn;

        if (muted) {
            stopMeter(me.id);
        } else if (localAudio) {
            startMeter(me.id, localStream);
        }

        toast(muted ? 'Ustoz mikrofonni o‘chirdi.' : 'Ustoz mikrofonni yoqdi.', muted ? 'warn' : '');
        renderPeople();
        refreshMediaTiles();
    }

    function onKick(msg) {
        if (Number(msg.target_user_id) !== me.id) return;
        leaving = true;
        toast('Ustoz sizni darsdan chiqardi.', 'error');
        teardown();
        setTimeout(() => { window.location.href = homeUrl; }, 1400);
    }

    /* ------------------------------------------------------------------
       AUDIO METER — yashil daraja ko'rsatkichi
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

    function startMeter(userId, stream) {
        userId = Number(userId);
        stopMeter(userId);
        if (!stream) return;
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState === 'ended') return;

        const ctx = audioContext();
        if (!ctx) return;

        try {
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.6;
            source.connect(analyser);

            const buffer = new Uint8Array(analyser.frequencyBinCount);
            const entry = { analyser: analyser, buffer: buffer, raf: 0, level: 0, source: source };
            meters.set(userId, entry);

            let lastSpeaking = false;
            let reportAt = 0;

            const loop = () => {
                if (meters.get(userId) !== entry) return;
                analyser.getByteFrequencyData(buffer);
                let sum = 0;
                for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
                const rms = Math.sqrt(sum / buffer.length) / 255;
                const level = Math.max(0, Math.min(100, Math.round(Math.pow(rms, 0.55) * 200)));
                entry.level = level;

                const user = users.get(userId);
                const muted = user ? user.micMuted : false;
                // Sust shovqin ham "gapiradi" deb ko'rinmasligi uchun chegara
                const speaking = !muted && level > 18;
                if (user) user.level = level;

                paintMeter(userId, muted ? 0 : level);
                if (speaking !== lastSpeaking) {
                    lastSpeaking = speaking;
                    setSpeaking(userId, speaking);
                }

                // Serverga "gapiradi" holatini kamdan-kam yuboramiz (boshqa
                // qurilmalarda analyzer ishlamasa ham indikator ko'rinsin)
                const now = performance.now();
                if (isSelf(userId) && speaking !== reportedSpeaking && (now - reportAt > 300)) {
                    reportedSpeaking = speaking;
                    reportAt = now;
                    sendSignal('speaking', { speaking: speaking });
                }

                entry.raf = requestAnimationFrame(loop);
            };
            entry.raf = requestAnimationFrame(loop);
        } catch (error) {
            console.warn('[live-room] meter error', error);
        }
    }

    function startRemoteMeter(userId, retry) {
        const id = Number(userId);
        const entry = peers.get(id);
        if (!entry) return;
        const user = users.get(id);
        if (user && user.micMuted) return;
        if (meters.has(id)) return;
        const audioTrack = entry.remoteStream.getAudioTracks()[0];
        if (!audioTrack || audioTrack.readyState === 'ended') {
            if (retry) setTimeout(() => startRemoteMeter(id, false), 900);
            return;
        }
        startMeter(id, entry.remoteStream);
    }

    function stopMeter(userId) {
        userId = Number(userId);
        const entry = meters.get(userId);
        if (entry) {
            cancelAnimationFrame(entry.raf);
            try { entry.source.disconnect(); } catch (error) { /* noop */ }
            try { entry.analyser.disconnect(); } catch (error) { /* noop */ }
            meters.delete(userId);
        }
        const user = users.get(userId);
        if (user) user.level = 0;
        paintMeter(userId, 0);
        setSpeaking(userId, false);
    }

    function paintMeter(userId, level) {
        const width = Math.max(0, Math.min(100, level || 0)) + '%';
        const user = users.get(Number(userId));
        if (user && !user.speaking && level) user.level = level;
        document.querySelectorAll('[data-meter-for="' + userId + '"]').forEach((bar) => {
            bar.style.width = width;
        });
        if (isSelf(userId) && ui.myLevel) ui.myLevel.style.width = width;
    }

    function setSpeaking(userId, speaking) {
        userId = Number(userId);
        const user = users.get(userId);
        if (!user) return;
        if (user.micMuted && speaking) speaking = false;
        const changed = user.speaking !== speaking;
        user.speaking = speaking;

        if (isSelf(userId)) {
            reportedSpeaking = speaking;
            if (ui.micBtn) ui.micBtn.classList.toggle('is-speaking', speaking);
        }

        if (!changed) return;
        paintSpeaking(userId, speaking);
        renderSpeakingChip();
        scheduleSpeakingReset(userId, speaking);
        refreshLiveIndicators();
    }

    function scheduleSpeakingReset(userId, speaking) {
        clearSpeakingTimer(userId);
        if (!speaking) return;
        // "Gapiradi" signali kelmagani holda ham indikator abadiy yonib qolmasin
        if (meters.has(userId)) return;
        speakingTimers.set(userId, setTimeout(() => {
            const user = users.get(userId);
            if (user && user.speaking) {
                user.speaking = false;
                paintSpeaking(userId, false);
                renderSpeakingChip();
            }
        }, 4000));
    }

    function clearSpeakingTimer(userId) {
        const timer = speakingTimers.get(Number(userId));
        if (timer) clearTimeout(timer);
        speakingTimers.delete(Number(userId));
    }

    function paintSpeaking(userId, speaking) {
        userId = Number(userId);

        if (ui.peopleList) {
            const row = ui.peopleList.querySelector('.people-row[data-user-id="' + userId + '"]');
            if (row) row.classList.toggle('is-speaking', speaking);
        }

        [ui.grid, ui.stripList].forEach((container) => {
            if (!container) return;
            const tile = container.querySelector('.tile[data-user-id="' + userId + '"]');
            if (tile) tile.classList.toggle('is-speaking', speaking);
        });

        if ((isHostUser(userId) || (isTeacher && isSelf(userId))) && ui.pip) {
            ui.pip.classList.toggle('is-speaking', speaking);
        }
        renderSpeakingChip();
    }

    function renderSpeakingChip() {
        if (!ui.speakingChip) return;
        const speaker = sortedUsers().find((user) => user.speaking);
        if (!speaker) {
            ui.speakingChip.hidden = true;
            return;
        }
        ui.speakingChip.hidden = false;
        if (ui.speakingName) ui.speakingName.textContent = speaker.name;
    }

    /* ------------------------------------------------------------------
       RENDER — qatnashchilar paneli
       ------------------------------------------------------------------ */
    function micBadge(user) {
        if (!user) return '';
        return '<span class="mic-badge' + (user.micMuted ? ' is-muted' : '') + '">'
            + (user.micMuted ? ICON.micOff : ICON.micOn) + '</span>';
    }

    // Yon paneldagi qatorni joyida yangilash (butun ro'yxatni qayta chizmaslik)
    // — ovoz darajasi barining uzluksiz harakati uchun kerak.
    function syncPeopleRows() {
        if (!ui.peopleList) return;
        sortedUsers().forEach((user) => {
            const row = ui.peopleList.querySelector('.people-row[data-user-id="' + user.id + '"]');
            if (!row) return;
            row.classList.toggle('is-speaking', Boolean(user.speaking));
            const micSlot = row.querySelector('[data-user-mic]');
            if (micSlot) micSlot.innerHTML = micBadge(user);
            const bar = row.querySelector('[data-meter-for="' + user.id + '"]');
            if (bar) bar.style.width = (user.micMuted ? 0 : (user.level || 0)) + '%';
        });
    }

    function renderPeople() {
        if (!ui.peopleList) return;
        const list = sortedUsers();
        if (ui.peopleCount) ui.peopleCount.textContent = String(list.length);
        if (ui.countNum) ui.countNum.textContent = String(list.length);
        ui.peopleList.innerHTML = '';

        if (!list.length) {
            ui.peopleList.innerHTML = '<div class="people-empty">Hozircha hech kim yo‘q</div>';
            return;
        }

        list.forEach((user) => {
            const row = document.createElement('div');
            row.className = 'people-row'
                + (isSelf(user.id) ? ' is-me' : '')
                + (user.speaking ? ' is-speaking' : '');
            row.dataset.userId = String(user.id);

            const roleTag = isHostUser(user.id)
                ? '<span class="tag tag--host">Ustoz</span>'
                : (isSelf(user.id) ? '<span class="tag">Siz</span>' : '');

            const showMicToggle = isTeacher && !isSelf(user.id) && !isHostUser(user.id);
            const showKick = isTeacher && !isSelf(user.id) && !isHostUser(user.id);
            const micBtn = showMicToggle
                ? '<button type="button" class="tile-btn ' + (user.micMuted ? 'is-muted' : 'is-on')
                + '" data-action="mute" data-user="' + user.id + '" title="'
                + (user.micMuted ? 'Mikrofonni yoqish' : 'Mikrofonni o‘chirish') + '">'
                + (user.micMuted ? ICON.micOff : ICON.micOn) + '</button>'
                : '';
            const kickBtn = showKick
                ? '<button type="button" class="tile-btn" data-action="kick" data-user="' + user.id
                + '" title="Darsdan chiqarish">' + ICON.kick + '</button>'
                : '';

            row.innerHTML =
                '<div class="people-avatar">' + esc(initials(user.name)) + '</div>'
                + '<div class="people-info">'
                + '<div class="people-name">'
                + '<span class="people-mic" data-user-mic="' + user.id + '">' + micBadge(user) + '</span>'
                + '<span class="people-name-text" title="' + esc(user.name) + '">' + esc(user.name) + '</span>'
                + roleTag + '</div>'
                + '<div class="people-sub"><div class="meter"><div class="meter__fill" data-meter-for="'
                + user.id + '"></div></div></div>'
                + '</div>'
                + '<div class="people-actions">' + micBtn + kickBtn + '</div>';

            ui.peopleList.appendChild(row);
            paintMeter(user.id, user.micMuted ? 0 : user.level || 0);
        });
    }

    /* ------------------------------------------------------------------
       RENDER — video to'r (grid)
       ------------------------------------------------------------------ */
    function buildTile(user, options) {
        options = options || {};
        const tile = document.createElement('div');
        tile.className = 'tile'
            + (isSelf(user.id) ? ' is-me' : '')
            + (user.speaking ? ' is-speaking' : '')
            + (user.micMuted ? ' is-muted' : '')
            + (maximizedId === user.id ? ' is-maximized' : '');
        tile.dataset.userId = String(user.id);

        const stream = streamFor(user.id);
        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        if (isSelf(user.id)) video.classList.add('is-mirrored');

        const placeholder = document.createElement('div');
        placeholder.className = 'tile__placeholder';
        placeholder.innerHTML = '<span>' + esc(initials(user.name)) + '</span>';

        const label = document.createElement('div');
        label.className = 'tile__label';
        label.innerHTML = micBadge(user)
            + '<span class="tile__name">' + esc(options.short ? shortName(user.name) : user.name) + '</span>'
            + (isHostUser(user.id) ? '<span class="tile__role">Ustoz</span>' : (isSelf(user.id) ? '<span class="tile__role">Siz</span>' : ''));

        const meter = document.createElement('div');
        meter.className = 'meter tile__meter';
        meter.innerHTML = '<div class="meter__fill" data-meter-for="' + user.id + '"></div>';

        tile.appendChild(video);
        tile.appendChild(placeholder);
        tile.appendChild(label);
        tile.appendChild(meter);

        const toolbar = document.createElement('div');
        toolbar.className = 'tile__toolbar';
        const maxBtn = document.createElement('button');
        maxBtn.type = 'button';
        maxBtn.className = 'tile-btn';
        maxBtn.dataset.maximize = String(user.id);
        maxBtn.title = maximizedId === user.id ? 'Kichraytirish' : 'Kattalashtirish';
        maxBtn.innerHTML = maximizedId === user.id ? ICON.min : ICON.max;
        toolbar.appendChild(maxBtn);
        tile.appendChild(toolbar);

        const hasVideo = hasLiveVideo(user.id) && !user.noCam;
        if (hasVideo) {
            video.srcObject = stream;
            video.classList.remove('is-hidden');
            placeholder.hidden = true;
            video.play().catch(() => {});
        } else {
            video.classList.add('is-hidden');
            placeholder.hidden = false;
        }

        tile.addEventListener('dblclick', (event) => {
            if (event.target.closest('button')) return;
            toggleMaximize(user.id);
        });
        maxBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleMaximize(user.id);
        });

        paintMeter(user.id, user.micMuted ? 0 : (user.level || 0));
        return tile;
    }

    function computeColumns(count) {
        const stage = ui.stage;
        if (!stage || count <= 1) return 1;
        const width = stage.clientWidth || 1;
        const height = stage.clientHeight || 1;
        // Ustoz PiP ustida turgani uchun grid kengligi torayadi
        const pipWidth = stage.classList.contains('pip-open') && ui.pip && !ui.pip.hidden
            ? ui.pip.getBoundingClientRect().width + 20
            : 0;
        const usableRatio = Math.max(0.35, (width - pipWidth) / Math.max(1, height));
        const ratio = usableRatio;
        let cols = Math.ceil(Math.sqrt(count * ratio));
        const maxCols = width > 1100 ? 5 : 4;
        cols = Math.max(1, Math.min(maxCols, cols));
        const rows = Math.ceil(count / cols);
        if (rows * cols - count >= cols && cols > 1) cols -= 1;
        return Math.max(1, cols);
    }

    function renderGrid() {
        if (!ui.grid) return;
        // Grid faqat o'quvchilar to'ri: ustoz alohida PiP oynachada turadi
        const list = sortedUsers().filter((user) => !isHostUser(user.id));
        const scrollTop = ui.grid.scrollTop;
        ui.grid.innerHTML = '';
        ui.grid.classList.toggle('is-single', Boolean(maximizedId));
        ui.grid.classList.toggle('is-lone', list.length === 1);
        ui.grid.style.setProperty('--cols', String(computeColumns(list.length)));

        list.forEach((user) => {
            const tile = buildTile(user, { short: list.length > 4 });
            if (maximizedId === user.id) tile.classList.add('is-maximized');
            ui.grid.appendChild(tile);
        });
        ui.grid.scrollTop = scrollTop;

        // Kutish ekrani faqat qatnashchilar hali ko'rinmasa chiqadi
        if (ui.hint) ui.hint.hidden = screenOwnerId !== null || list.length > 0;
        ui.stage.classList.toggle('screen-mode', screenOwnerId !== null);
    }

    function renderStrip() {
        if (!ui.stripList || !ui.strip) return;
        // Ekran rejimida: ustoz strip'da ko'rsatilmaydi (u PiP'da), ekran egasi ham
        const list = sortedUsers().filter((user) => screenOwnerId === null || user.id !== screenOwnerId);
        ui.strip.hidden = screenOwnerId === null || list.length === 0;
        ui.stripList.innerHTML = '';
        list.forEach((user) => {
            const tile = buildTile(user, { short: true });
            tile.addEventListener('click', (event) => {
                if (event.target.closest('button')) return;
                toggleMaximize(user.id);
            });
            ui.stripList.appendChild(tile);
        });
    }

    function refreshMediaTiles() {
        renderGrid();
        renderStrip();
        renderPip();
    }

    /* ------------------------------------------------------------------
       PiP — ustoz oynachasi
       ------------------------------------------------------------------ */
    /*
       Ustoz oynachasi (PiP):
       • Ekran uzatilmasa  -> ustoz kamerasi burchakda, grid ustidagi ustki qatlamda
       • Ekran uzatilsa    -> ustoz kamerasi chap yuqori burchakda qoladi
       • Ustozning o'zida  -> o'z kamerasi PiP'da ko'rinmaydi (u grid'da)
    */
    function renderPip() {
        if (!ui.pip) return;

        const own = users.get(me.id);
        const host = isTeacher ? own : (teacherId != null ? users.get(teacherId) : null);
        const show = Boolean(host);
        ui.pip.hidden = !show;
        if (ui.stage) ui.stage.classList.toggle('pip-open', show && screenOwnerId === null);

        if (!show) {
            if (ui.pipVideo && ui.pipVideo.srcObject) ui.pipVideo.srcObject = null;
            return;
        }

        if (ui.pipName) ui.pipName.textContent = host.name + (isTeacher ? ' (Siz)' : '');
        if (ui.pipInitials) ui.pipInitials.textContent = initials(host.name);
        if (ui.pipMic) {
            ui.pipMic.innerHTML = host.micMuted ? ICON.micOff : ICON.micOn;
            ui.pipMic.classList.toggle('is-muted', Boolean(host.micMuted));
            ui.pipMic.classList.toggle('is-live', Boolean(host.speaking) && !host.micMuted);
        }
        ui.pip.classList.toggle('is-speaking', Boolean(host.speaking));
        ui.pip.classList.toggle('is-maximized', maximizedId === host.id);

        const stream = streamFor(host.id);
        const hasVideo = Boolean(stream) && hasLiveVideo(host.id) && !host.noCam;
        const muted = Boolean(host.micMuted);

        if (ui.pipVideo) {
            if (hasVideo) {
                if (ui.pipVideo.srcObject !== stream) ui.pipVideo.srcObject = stream;
                ui.pipVideo.classList.remove('is-hidden');
                // O'z oynasida oynani ikki marta eshitmaslik uchun muted
                ui.pipVideo.muted = true;
                ui.pipVideo.play().catch(() => {});
            } else {
                ui.pipVideo.classList.add('is-hidden');
                if (ui.pipVideo.srcObject) ui.pipVideo.srcObject = null;
            }
        }

        const hasPhoto = !hasVideo && !muted && Boolean(CFG.teacherPhoto) && !isTeacher;
        if (ui.pipPhoto) {
            if (hasPhoto) {
                ui.pipPhoto.src = CFG.teacherPhoto;
                ui.pipPhoto.hidden = false;
            } else {
                ui.pipPhoto.hidden = true;
            }
        }
        if (ui.pipPlaceholder) ui.pipPlaceholder.hidden = hasVideo || hasPhoto;

        paintMeter(host.id, muted ? 0 : (host.level || 0));
    }

    /* ------------------------------------------------------------------
       EKRAN UZATISH
       ------------------------------------------------------------------ */
    function remoteScreenEntry() {
        if (screenOwnerId === null) return null;
        return peers.get(screenOwnerId) || null;
    }

    function renderScreen() {
        if (!ui.stage) return;
        const active = screenOwnerId !== null || Boolean(screenStream);
        if (ui.stage.classList.contains('screen-mode') !== active) {
            ui.stage.classList.toggle('screen-mode', active);
            // Rejim almashganda ustoz PiP joylashuvi va qora fon qayta chiziladi
            requestAnimationFrame(() => renderPip());
        }

        if (ui.screenChip) ui.screenChip.hidden = !active;
        if (active && ui.screenChipText) {
            const owner = users.get(screenOwnerId);
            ui.screenChipText.textContent = owner
                ? (owner.name + ' ekrani')
                : 'Ekran uzatilmoqda';
        }

        if (!active) {
            if (ui.screenVideo && ui.screenVideo.srcObject) {
                ui.screenVideo.srcObject = null;
            }
            if (ui.screenEmpty) ui.screenEmpty.hidden = true;
            if (ui.hint) ui.hint.hidden = users.size > 0;
            if (ui.shareText) ui.shareText.textContent = 'Ekranni uzatish';
            if (ui.shareBtn) ui.shareBtn.classList.remove('ctrl-btn--muted');
            return;
        }

        if (ui.hint) ui.hint.hidden = true;

        let stream = null;
        if (screenOwnerId === me.id && screenStream) {
            stream = screenStream;
        } else {
            // Faqat ustozning ekran oqimi katta maydonda ko'rsatiladi
            const entry = remoteScreenEntry();
            if (entry && entry.remoteScreenTrack && entry.remoteScreenTrack.readyState !== 'ended') {
                stream = new MediaStream([entry.remoteScreenTrack]);
            } else if (entry && entry.remoteStream.getVideoTracks().length) {
                stream = entry.remoteStream;
            }
        }

        if (ui.screenVideo && stream) {
            if (ui.screenVideo.srcObject !== stream) ui.screenVideo.srcObject = stream;
            ui.screenVideo.play().catch(() => {});
        }
        if (ui.screenEmpty) ui.screenEmpty.hidden = Boolean(stream);

        if (isTeacher && ui.shareText) {
            ui.shareText.textContent = screenStream ? 'Uzatishni to‘xtatish' : 'Ekranni uzatish';
        }
        if (ui.shareBtn) ui.shareBtn.classList.toggle('ctrl-btn--muted', Boolean(screenStream));
        renderStrip();
        renderPip();
    }

    async function toggleShareScreen() {
        if (!isTeacher) return;
        if (screenStream) {
            stopShareScreen();
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            toast('Brauzer ekran uzatishni qo‘llab-quvvatlamaydi.', 'error');
            return;
        }

        let display;
        try {
            display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        } catch (error) {
            toast('Ekran uzatish bekor qilindi.', 'warn');
            return;
        }

        const track = display.getVideoTracks()[0];
        if (!track) return;

        screenStream = display;
        screenOwnerId = me.id;
        track.onended = () => { stopShareScreen(); };

        // Ekran trackini alohida "screen" sender sifatida qo'shamiz
        peers.forEach((entry) => {
            if (entry.senders.screen) {
                try { entry.senders.screen.replaceTrack(track); } catch (error) { /* noop */ }
                return;
            }
            try {
                entry.senders.screen = entry.pc.addTrack(track, display);
                // Yangi track — yangi offer kerak
                if (entry.hasOfferStarted) negotiate(entry).catch(() => {});
            } catch (error) { /* noop */ }
        });

        sendSignal('screen-share-start', { screen_owner_id: me.id });
        refreshAll();
        addChat('Tizim', 'Ekran uzatish boshlandi.', 'system');
    }

    function stopShareScreen() {
        if (!screenStream) {
            if (screenOwnerId === me.id) screenOwnerId = null;
            refreshAll();
            return;
        }

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

        sendSignal('screen-share-stop', { screen_owner_id: me.id });
        // Qayta renegotiation: ekran track'i olib tashlangach ulanish barqaror bo'lsin
        peers.forEach((entry) => {
            if (entry.hasOfferStarted) negotiate(entry).catch(() => {});
        });
        refreshAll();
        addChat('Tizim', 'Ekran uzatish to‘xtatildi.', 'system');
    }

    function onScreenStart(msg) {
        screenOwnerId = Number(msg.screen_owner_id || msg.sender_id);
        if (msg.message) addChat('Tizim', msg.message, 'system');
        refreshAll();
    }

    function onScreenStop(msg) {
        const owner = Number(msg.screen_owner_id || msg.sender_id);
        if (screenOwnerId === null || owner === screenOwnerId) {
            screenOwnerId = null;
        }
        if (msg.message) addChat('Tizim', msg.message, 'system');
        refreshAll();
    }

    /* ------------------------------------------------------------------
       Kattalashtirish
       ------------------------------------------------------------------ */
    function toggleMaximize(id) {
        id = Number(id);
        maximizedId = maximizedId === id ? null : id;
        refreshMediaTiles();
    }

    /* ------------------------------------------------------------------
       CHAT
       ------------------------------------------------------------------ */
    function addChat(sender, message, kind) {
        if (!ui.chat || message == null || message === '') return;
        const item = document.createElement('div');
        item.className = 'chat-item' + (kind ? ' chat-item--' + kind : '');
        const label = kind === 'me' ? 'Siz' : (sender || 'Tizim');
        item.innerHTML = '<div class="chat-item__meta">' + esc(label) + '</div>'
            + '<div class="chat-item__body">' + esc(message) + '</div>';
        ui.chat.appendChild(item);
        while (ui.chat.children.length > 150) ui.chat.firstElementChild.remove();
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
        renderScreen();
        renderStrip();
        renderPip();
        updateMicButton();
        updateMuteAllButton();
    }

    /*
       Jonli indikatorlar (ovoz darajasi, "gapiradi" holati) uchun yengil
       yangilanish: DOM qayta qurilmaydi, faqat mavjud qatorlar holati
       o'zgaradi.
    */
    function refreshLiveIndicators() {
        syncPeopleRows();
        document.querySelectorAll('.tile[data-user-id]').forEach((tile) => {
            const user = users.get(Number(tile.dataset.userId));
            if (!user) return;
            tile.classList.toggle('is-speaking', Boolean(user.speaking));
            tile.classList.toggle('is-muted', Boolean(user.micMuted));
        });
        renderPip();
    }

    function updateMuteAllButton() {
        if (!ui.muteAllBtn) return;
        const muted = ui.muteAllBtn.dataset.muted === '1';
        if (ui.muteAllText) ui.muteAllText.textContent = muted ? 'Hammasini yoqish' : 'Hammasini o‘chirish';
        ui.muteAllBtn.classList.toggle('ctrl-btn--muted', muted);
    }

    /* ------------------------------------------------------------------
       HODISALAR
       ------------------------------------------------------------------ */
    function onPeopleAction(event) {
        const btn = event.target.closest('[data-action]');
        if (!btn) return;
        const targetId = Number(btn.dataset.user);
        const action = btn.dataset.action;
        const user = users.get(targetId);
        if (!user) return;

        if (action === 'mute') {
            const turnOn = user.micMuted;
            // Optimistik yangilash — keyin server holati tasdiqlaydi
            user.micMuted = !turnOn;
            sendSignal(turnOn ? 'unmute_user' : 'mute_user', { target_user_id: targetId });
            renderPeople();
            refreshMediaTiles();
        } else if (action === 'kick') {
            sendSignal('kick_user', { target_user_id: targetId });
        }
    }

    function setSideVisible(visible) {
        if (!ui.side) return;
        ui.side.classList.toggle('is-collapsed', !visible);
        if (ui.app) ui.app.classList.toggle('side-collapsed', !visible);
        if (ui.peopleToggle) {
            ui.peopleToggle.classList.toggle('ctrl-btn--on', visible);
            ui.peopleToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
        }
        setTimeout(() => { renderGrid(); renderStrip(); }, 220);
    }

    function bindEvents() {
        if (ui.micBtn) ui.micBtn.addEventListener('click', toggleMic);
        if (ui.camBtn) ui.camBtn.addEventListener('click', toggleCamera);
        if (ui.shareBtn) ui.shareBtn.addEventListener('click', toggleShareScreen);

        if (ui.muteAllBtn) {
            ui.muteAllBtn.addEventListener('click', () => {
                const muted = ui.muteAllBtn.dataset.muted === '1';
                if (!sendSignal(muted ? 'unmute_all' : 'mute_all')) toast('Ulanish tayyor emas.', 'warn');
            });
        }

        if (ui.peopleList) ui.peopleList.addEventListener('click', onPeopleAction);

        if (ui.chatForm) ui.chatForm.addEventListener('submit', submitChat);

        if (ui.leaveBtn) {
            ui.leaveBtn.addEventListener('click', () => {
                leaving = true;
                sendSignal('leave');
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
                setTimeout(() => { renderGrid(); renderStrip(); }, 250);
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

        if (ui.peopleToggle) {
            ui.peopleToggle.addEventListener('click', () => {
                setSideVisible(ui.side.classList.contains('is-collapsed'));
            });
        }

        if (ui.pip) {
            const btn = ui.pip.querySelector('[data-pip-max]');
            if (btn) {
                btn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (teacherId != null) toggleMaximize(teacherId);
                });
            }
        }

        window.addEventListener('beforeunload', () => { leaving = true; teardown(); });
        document.addEventListener('visibilitychange', () => {
            // Tab qayta faollashganda ro'yxat holatini sinxronlaymiz
            if (!document.hidden && joined) sendSignal('roster-sync');
        });

        const unlock = () => {
            [ui.screenVideo, ui.pipVideo].forEach((video) => {
                if (video && video.srcObject) video.play().catch(() => {});
            });
            document.querySelectorAll('.tile video').forEach((video) => {
                if (video.srcObject) video.play().catch(() => {});
            });
            if (audioCtxRef.ctx && audioCtxRef.ctx.state === 'suspended') audioCtxRef.ctx.resume().catch(() => {});
        };
        document.addEventListener('click', unlock);
        document.addEventListener('touchstart', unlock, { passive: true });

        let resizeTimer = 0;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { renderGrid(); renderStrip(); }, 180);
        });
    }

    function teardown() {
        leaving = true;
        if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
            localStream = null;
            localAudio = null;
            localVideo = null;
        }
        if (screenStream) {
            screenStream.getTracks().forEach((track) => { track.onended = null; track.stop(); });
            screenStream = null;
        }
        [...peers.keys()].forEach(destroyPeer);
        [...meters.keys()].forEach(stopMeter);
        try { if (socket && socket.readyState === WebSocket.OPEN) socket.close(); } catch (error) { /* noop */ }
    }

    /* ------------------------------------------------------------------
       INIT
       ------------------------------------------------------------------ */
    async function init() {
        if (!me.id || !Number(CFG.lessonId)) {
            toast('Dars ma’lumotlari topilmadi.', 'error');
            return;
        }

        const own = upsertUser(me.id, { name: me.name, role: me.role });
        own.micMuted = !micOn || mutedByHost;
        if (teacherId && teacherId !== me.id) upsertUser(teacherId, { name: CFG.teacherName, role: 'teacher' });

        if (isTeacher) {
            if (ui.shareBtn) ui.shareBtn.hidden = false;
            if (ui.muteAllBtn) ui.muteAllBtn.hidden = false;
            if (ui.badgeText) ui.badgeText.textContent = 'Jonli';
            if (ui.hintText) {
                ui.hintText.textContent = 'Kamera va mikrofon ruxsatini bering. Qatnashchilar kirgach, ular shu qora fonga to‘ri (grid) shaklida chiqadi.';
            }
        } else if (ui.badgeText) {
            ui.badgeText.textContent = CFG.isLive ? 'Jonli' : 'Kutilyapti';
        }

        updateMicButton();
        updateCamButton();
        updateMuteAllButton();
        bindEvents();
        refreshAll();

        connect();

        try {
            await startLocalMedia();
        } catch (error) {
            console.warn('[live-room] local media', error);
        }

        // Ustoz ham pudratchi, ham mijoz: 1.5 s ichida hech kim kirmasa,
        // ro'yxatni qayta sinxronlaymiz (qora fon abadiy "kutish" bo'lib
        // qolmasligi uchun).
        setTimeout(() => {
            if (!users.size || users.size === 1) refreshAll();
        }, 1500);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
