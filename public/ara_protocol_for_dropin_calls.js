// Filename: ara_protocol_for_dropin_calls.js

const SIGNALING_SERVER_URL = window.location.origin; 
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    }
];

// --- Duo UI Mapping ---
let localCanvas, remoteCanvas, remoteVideoHidden, sourceVideo;
let localCtx, remoteCtx;
let drawLocalActive = false;

// --- State ---
let socket = null;
let roomId = null;
let localStream = null;
let peerConnections = {}; 
let remoteStream = null;

function initARA() {
    console.log("ARA WebRTC Protocol Active");

    // Map UI Canvases
    localCanvas = document.getElementById('c-local-video');
    remoteCanvas = document.getElementById('c-remote-video');
    localCtx = localCanvas.getContext('2d');
    remoteCtx = remoteCanvas.getContext('2d');

    // Hidden video elements
    sourceVideo = document.getElementById('source-video');
    sourceVideo.autoplay = true;
    sourceVideo.playsInline = true;
    sourceVideo.muted = true;

    remoteVideoHidden = document.createElement('video');
    remoteVideoHidden.autoplay = true;
    remoteVideoHidden.playsInline = true;
    remoteVideoHidden.style.display = 'none';
    document.body.appendChild(remoteVideoHidden);

    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);

    // Override UI Button Logic
    document.getElementById('toggle-mic').addEventListener('click', async () => {
        if (!localStream) {
            await startLocalStream();
        } else {
            const enabled = !localStream.getAudioTracks()[0].enabled;
            localStream.getAudioTracks()[0].enabled = enabled;
            document.querySelector('#toggle-mic .label').innerText = enabled ? "Mute" : "Unmute";
        }
    });

    document.getElementById('toggle-cam').addEventListener('click', async () => {
        if (!localStream) {
            await startLocalStream();
        } else {
            const enabled = !localStream.getVideoTracks()[0].enabled;
            localStream.getVideoTracks()[0].enabled = enabled;
            document.querySelector('#toggle-cam .label').innerText = enabled ? "Camera" : "Cam Off";
        }
    });

    document.getElementById('btn-hangup').onclick = leaveMeeting;

    // Room ID from hash
    roomId = window.location.hash.substring(1) || Math.random().toString(36).substring(2, 8);
    if (!window.location.hash) window.location.hash = roomId;

    // Connect to server immediately to listen for peers, but DON'T start camera yet
    connectToServer();
}

async function startLocalStream() {
    try {
        console.log("Requesting Hardware Access...");
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        sourceVideo.srcObject = localStream;
await sourceVideo.play();

        Object.values(peerConnections).forEach(pc => {
            if (localStream) if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        });

        if (!drawLocalActive) {
            drawLocalActive = true;
            requestAnimationFrame(drawLocal);
        }

        document.getElementById('connection-quality').innerText = "🟢 Media Active";
    } catch (err) {
        console.error("Camera access denied:", err);
        document.getElementById('connection-quality').innerText = "🔴 Access Denied";
    }
}

function connectToServer() {
    socket = io(SIGNALING_SERVER_URL);

    socket.on('connect', () => {
        socket.emit('join', roomId);
    });

    socket.on('existing_users', (users) => {
        // Strict Duo Limit: Only connect if room is not full
        if (users.length > 0) connectToPeer(users[0], true);
    });

    socket.on('user_joined', (peerId) => {
        // Only accept if we don't have a peer yet
        if (Object.keys(peerConnections).length === 0) {
            connectToPeer(peerId, false);
        }
    });

    socket.on('offer', ({ senderId, offer }) => handleOffer(senderId, offer));
    socket.on('answer', ({ senderId, answer }) => handleAnswer(senderId, answer));
    socket.on('ice_candidate', ({ senderId, candidate }) => handleCandidate(senderId, candidate));
    
    socket.on('user_left', (peerId) => {
        if (peerConnections[peerId]) {
            peerConnections[peerId].close();
            delete peerConnections[peerId];
            remoteStream = null;
            document.getElementById('remote-waiting').style.display = 'block';
            document.getElementById('connection-quality').innerText = "Signal: Weak";
        }
    });
}

function createPeer(peerId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnections[peerId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('ice_candidate', { targetId: peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
        remoteStream = e.streams[0];
        remoteVideoHidden.srcObject = remoteStream;
        document.getElementById('remote-waiting').style.display = 'none';
        document.getElementById('connection-quality').innerText = "Signal: Strong";
        requestAnimationFrame(drawRemote);
    };

    return pc;
}

async function connectToPeer(peerId, isInitiator) {
    const pc = createPeer(peerId);
    if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { targetId: peerId, offer });
    }
}

async function handleOffer(peerId, offer) {
    const pc = createPeer(peerId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { targetId: peerId, answer });
}

async function handleAnswer(peerId, answer) {
    const pc = peerConnections[peerId];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleCandidate(peerId, candidate) {
    const pc = peerConnections[peerId];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
}

function drawRemote() {
    if (remoteStream && remoteVideoHidden.readyState >= 2) {
        remoteCtx.drawImage(remoteVideoHidden, 0, 0, remoteCanvas.width, remoteCanvas.height);
    }
    if (remoteStream) requestAnimationFrame(drawRemote);
}

function drawLocal() {
    if (localStream && sourceVideo.readyState >= 2) {
        localCtx.drawImage(sourceVideo, 0, 0, localCanvas.width, localCanvas.height);
    }
    if (drawLocalActive) requestAnimationFrame(drawLocal);
}

function resizeCanvases() {
    const dpr = window.devicePixelRatio || 1;

    [localCanvas, remoteCanvas].forEach(canvas => {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    });
}

function leaveMeeting() {
    if (!confirm("End this call?")) return;
    Object.values(peerConnections).forEach(pc => pc.close());
    if (socket) socket.disconnect();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    location.reload();
}

// Start ARA Protocol
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initARA);
} else {
    initARA();
}