let localStream;
let peers = {}; // { peerId: RTCPeerConnection }
let userId = null;
let room = null;
let users = [];
const localVideo = document.getElementById('localVideo');
const videosDiv = document.getElementById('videos');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');

// --- Mute/Video Controls ---
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
let audioMuted = false;
let videoOff = false;

// --- Chat DOM ---
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
let chatLastTimestamp = 0;

// Generate a random user ID (could be replaced by login)
function genId() {
  return 'user-' + Math.floor(Math.random() * 1000000);
}

joinBtn.onclick = async function() {
  if (!roomInput.value) {
    alert('Enter a room name');
    return;
  }
  room = roomInput.value;
  userId = genId();
  await joinRoom();
};

async function joinRoom() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  // Button states
  audioMuted = false;
  videoOff = false;
  updateMuteButton();
  updateVideoButton();

  users = await joinAndGetUsers();

  setInterval(pollUsers, 1200);
  setInterval(pollSignals, 500);

  // Chat polling
  setInterval(pollChat, 800);

  // For all users already present (except me), create peer connections
  users.forEach(peerId => {
    if (peerId !== userId && !peers[peerId]) {
      createPeer(peerId);
    }
  });
}

async function joinAndGetUsers() {
  const res = await fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&user=${encodeURIComponent(userId)}&type=join`
  });
  return await res.json();
}

async function pollUsers() {
  const res = await fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&type=get_users`
  });
  const currentUsers = await res.json();

  // For any new user not already connected, create peer
  currentUsers.forEach(peerId => {
    if (peerId !== userId && !peers[peerId]) {
      createPeer(peerId);
    }
  });
  users = currentUsers;
}

function createPeer(peerId) {
  const pc = new RTCPeerConnection();
  peers[peerId] = pc;

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = e => {
    if (e.candidate) {
      sendSignal(peerId, JSON.stringify({ type: 'candidate', candidate: e.candidate }));
    }
  };

  pc.ontrack = e => {
    let remoteVideo = document.getElementById('video-' + peerId);
    if (!remoteVideo) {
      remoteVideo = document.createElement('video');
      remoteVideo.id = 'video-' + peerId;
      remoteVideo.autoplay = true;
      remoteVideo.playsInline = true;
      videosDiv.appendChild(remoteVideo);
    }
    remoteVideo.srcObject = e.streams[0];
  };

  // Only the user with the lexically higher ID initiates the offer
  if (userId > peerId) {
    pc.onnegotiationneeded = async () => {
      try {
        if (pc.signalingState === "stable") {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(peerId, JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
        }
      } catch (e) { /* ignore */ }
    };
  }
}

function sendSignal(targetId, data) {
  fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&user=${encodeURIComponent(userId)}&type=signal&target=${encodeURIComponent(targetId)}&data=${encodeURIComponent(data)}`
  });
}

async function pollSignals() {
  const res = await fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&user=${encodeURIComponent(userId)}&type=get_signals`
  });
  let msgs;
  try {
    msgs = await res.json();
  } catch {
    msgs = [];
  }
  for (const [from, msgStr] of msgs) {
    const msg = JSON.parse(msgStr);
    if (!peers[from]) createPeer(from);
    const pc = peers[from];

    if (msg.type === 'offer') {
      if (!pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(from, JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
      }
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'candidate') {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (e) { /* ignore */ }
    }
  }
}

// ------------- Chat logic -------------

if (chatForm) {
  chatForm.onsubmit = function(e) {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (msg.length === 0) return;
    sendChat(msg);
    chatInput.value = '';
  };
}

function sendChat(msg) {
  fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&user=${encodeURIComponent(userId)}&type=chat_send&data=${encodeURIComponent(msg)}`
  });
}

async function pollChat() {
  if (!room || !userId) return;
  const res = await fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&type=chat_get&since=${encodeURIComponent(chatLastTimestamp)}`
  });
  let msgs;
  try {
    msgs = await res.json();
  } catch {
    msgs = [];
  }
  let changed = false;
  msgs.forEach(({timestamp, user, message}) => {
    if (timestamp > chatLastTimestamp) chatLastTimestamp = timestamp;
    addChatMessage(user, message, timestamp);
    changed = true;
  });
  if (changed) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function addChatMessage(user, message, ts) {
  const div = document.createElement('div');
  if (user === userId) {
    div.innerHTML = `<b>You:</b> ${escapeHtml(message)}`;
  } else {
    div.innerHTML = `<b>${user}:</b> ${escapeHtml(message)}`;
  }
  chatMessages.appendChild(div);
}

// Basic XSS protection
function escapeHtml(unsafe) {
  return unsafe.replace(/[<>&"'`]/g, c => ({
    '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;','`':'&#96;'
  }[c]));
}

// --- Mute/Unmute and Video On/Off Logic ---

if (muteBtn) {
  muteBtn.onclick = function() {
    if (!localStream) return;
    audioMuted = !audioMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !audioMuted);
    updateMuteButton();
  };
}
if (videoBtn) {
  videoBtn.onclick = function() {
    if (!localStream) return;
    videoOff = !videoOff;
    localStream.getVideoTracks().forEach(track => track.enabled = !videoOff);
    updateVideoButton();
  };
}
function updateMuteButton() {
  muteBtn.textContent = audioMuted ? "Unmute" : "Mute";
}
function updateVideoButton() {
  videoBtn.textContent = videoOff ? "Video On" : "Video Off";
}