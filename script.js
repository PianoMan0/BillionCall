let localStream;
let peers = {};
let userId = null;
let room = null;
let users = [];
const localVideo = document.getElementById('localVideo');
const videosDiv = document.getElementById('videos');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
let audioMuted = false;
let videoOff = false;
const screenShareBtn = document.getElementById('screenShareBtn');
let isScreenSharing = false;
let originalVideoTrack = null;
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
let chatLastTimestamp = 0;
let callStartTime = null;
let chatMessageCount = 0;
const analyticsBtn = document.getElementById('analyticsBtn');
const analyticsPopup = document.getElementById('analyticsPopup');
const analyticsData = document.getElementById('analyticsData');
const closeAnalytics = document.getElementById('closeAnalytics');
let candidateQueue = {};
let peerMissingCounts = {};
const PEER_MISSING_THRESHOLD = 5;

// --- Admin UI ---
const adminLoginDiv = document.getElementById('adminLoginDiv');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminPasswordInput = document.getElementById('adminPasswordInput');
const adminPanel = document.getElementById('adminPanel');
const adminUserList = document.getElementById('adminUserList');
const endMeetingBtn = document.getElementById('endMeetingBtn');
let isAdmin = false;
let adminToken = null;

// Generate random user ID
function genId() {
  return 'user-' + Math.floor(Math.random() * 1000000);
}

// Heartbeat: send every 3 seconds, with retry
function startHeartbeat() {
  async function beat() {
    if (room && userId) {
      try {
        await fetch('signaling.php', {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: `room=${encodeURIComponent(room)}&user=${encodeURIComponent(userId)}&type=heartbeat`
        });
      } catch (e) {
        setTimeout(beat, 1000);
        return;
      }
    }
    setTimeout(beat, 3000);
  }
  beat();
}
async function pollUsersLoop() {
  while (true) {
    try {
      await pollUsers();
      await new Promise(res => setTimeout(res, 1000));
    } catch {
      await new Promise(res => setTimeout(res, 500));
    }
  }
}
async function pollSignalsLoop() {
  while (true) {
    try {
      await pollSignals();
      await new Promise(res => setTimeout(res, 300));
    } catch {
      await new Promise(res => setTimeout(res, 100));
    }
  }
}

joinBtn.onclick = async function() {
  if (!roomInput.value) {
    alert('Enter a room name');
    return;
  }
  room = roomInput.value;
  userId = genId();
  callStartTime = Date.now();
  await joinRoom();
};

async function joinRoom() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  audioMuted = false;
  videoOff = false;
  updateMuteButton();
  updateVideoButton();
  users = await joinAndGetUsers();
  startHeartbeat();
  pollUsersLoop();
  pollSignalsLoop();
  setInterval(pollChat, 1000);
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

  // If I disappeared, try to rejoin!
  if (!currentUsers.includes(userId)) {
    await joinAndGetUsers();
    return;
  }

  // Only remove a peer if gone for 5+ polls
  Object.keys(peers).forEach(peerId => {
    if (!currentUsers.includes(peerId)) {
      peerMissingCounts[peerId] = (peerMissingCounts[peerId] || 0) + 1;
      if (peerMissingCounts[peerId] >= PEER_MISSING_THRESHOLD) {
        const vid = document.getElementById('video-' + peerId);
        if (vid) vid.parentNode.removeChild(vid);
        try { peers[peerId].close(); } catch (e) {}
        delete peers[peerId];
        delete candidateQueue[peerId];
        delete peerMissingCounts[peerId];
      }
    } else {
      peerMissingCounts[peerId] = 0;
    }
  });

  // For any new user not already connected, create peer
  currentUsers.forEach(peerId => {
    if (peerId !== userId && !peers[peerId]) {
      createPeer(peerId);
    }
  });
  users = currentUsers;

  if (isAdmin) renderAdminUserList();
}

function createPeer(peerId) {
  if (peers[peerId]) {
    try { peers[peerId].close(); } catch (e) {}
    delete peers[peerId];
  }
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });
  peers[peerId] = pc;
  candidateQueue[peerId] = [];
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.onicecandidate = e => {
    if (e.candidate) {
      sendSignal(peerId, JSON.stringify({ type: 'candidate', candidate: e.candidate }));
    }
  };
  let remoteVideo = document.getElementById('video-' + peerId);
  if (!remoteVideo) {
    remoteVideo = document.createElement('video');
    remoteVideo.id = 'video-' + peerId;
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;
    videosDiv.appendChild(remoteVideo);
  }
  let remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  pc.ontrack = e => {
    e.streams[0].getTracks().forEach(track => {
      if (!remoteStream.getTracks().find(t => t.id === track.id)) {
        remoteStream.addTrack(track);
      }
    });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      setTimeout(() => {
        if (peers[peerId] === pc) createPeer(peerId);
      }, 1000);
    }
  };
  if (userId > peerId) {
    pc.onnegotiationneeded = async () => {
      try {
        if (pc.signalingState === "stable") {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(peerId, JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
        }
      } catch (e) {}
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
    if (!candidateQueue[from]) candidateQueue[from] = [];
    if (msg.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      candidateQueue[from].forEach(cand => pc.addIceCandidate(new RTCIceCandidate(cand)));
      candidateQueue[from] = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(from, JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      candidateQueue[from].forEach(cand => pc.addIceCandidate(new RTCIceCandidate(cand)));
      candidateQueue[from] = [];
    } else if (msg.type === 'candidate') {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch (e) {}
      } else {
        candidateQueue[from].push(msg.candidate);
      }
    } else if (msg.type === 'admin_kick' && msg.target === userId) {
      alert("You have been removed from this meeting by the admin.");
      location.reload();
    } else if (msg.type === 'admin_mute' && msg.target === userId) {
      if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = false);
        audioMuted = true;
        updateMuteButton();
      }
      alert("You have been muted by the admin.");
    } else if (msg.type === 'admin_end_meeting') {
      alert("The meeting has been ended by the admin.");
      location.reload();
    }
  }
}

// --- Screen Sharing ---
if (screenShareBtn) {
  screenShareBtn.onclick = async function() {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        originalVideoTrack = localStream.getVideoTracks()[0];
        Object.values(peers).forEach(pc => {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) sender.replaceTrack(screenTrack);
        });
        localVideo.srcObject = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
        isScreenSharing = true;
        screenShareBtn.textContent = "Stop Sharing";
        screenTrack.onended = () => stopScreenShare();
      } catch (err) {
        alert("Screen sharing failed: " + err);
      }
    } else {
      stopScreenShare();
    }
  };
}
function stopScreenShare() {
  if (!isScreenSharing || !originalVideoTrack) return;
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) sender.replaceTrack(originalVideoTrack);
  });
  localVideo.srcObject = localStream;
  isScreenSharing = false;
  screenShareBtn.textContent = "Share Screen";
}

// --- Admin logic ---

adminLoginBtn.onclick = async function() {
  const pwd = adminPasswordInput.value;
  if (!pwd || !room) return alert("Enter password and join a room first.");
  // Authenticate as admin
  const res = await fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&admin_password=${encodeURIComponent(pwd)}&type=admin_login`
  });
  const result = await res.json();
  if (result.success) {
    isAdmin = true;
    adminToken = result.token;
    adminLoginDiv.style.display = "none";
    adminPanel.style.display = "";
    renderAdminUserList();
  } else {
    alert("Wrong admin password!");
  }
};

function renderAdminUserList() {
  if (!isAdmin) return;
  adminUserList.innerHTML = '';
  users.forEach(u => {
    const div = document.createElement('div');
    div.textContent = u + (u === userId ? " (You)" : "");
    if (u !== userId) {
      const kickBtn = document.createElement('button');
      kickBtn.textContent = "Kick";
      kickBtn.onclick = () => adminKickUser(u);
      div.appendChild(kickBtn);

      const muteBtn = document.createElement('button');
      muteBtn.textContent = "Mute";
      muteBtn.onclick = () => adminMuteUser(u);
      div.appendChild(muteBtn);
    }
    adminUserList.appendChild(div);
  });
}
async function adminKickUser(peer) {
  if (!isAdmin) return;
  await fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&type=admin_action&admin_token=${encodeURIComponent(adminToken)}&action=kick&target=${encodeURIComponent(peer)}`
  });
}
async function adminMuteUser(peer) {
  if (!isAdmin) return;
  await fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&type=admin_action&admin_token=${encodeURIComponent(adminToken)}&action=mute&target=${encodeURIComponent(peer)}`
  });
}
endMeetingBtn.onclick = async function() {
  if (!isAdmin) return;
  await fetch('signaling.php', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `room=${encodeURIComponent(room)}&type=admin_action&admin_token=${encodeURIComponent(adminToken)}&action=end_meeting`
  });
};

// --- Reliability: heartbeat/poll on tab visibility change or focus ---
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && room && userId) {
    fetch('signaling.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: `room=${encodeURIComponent(room)}&user=${encodeURIComponent(userId)}&type=heartbeat`
    });
    pollUsers();
  }
});
window.addEventListener('focus', () => {
  if (room && userId) {
    fetch('signaling.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: `room=${encodeURIComponent(room)}&user=${encodeURIComponent(userId)}&type=heartbeat`
    });
    pollUsers();
  }
});

// --- Remove self from users file on page unload ---
window.addEventListener('beforeunload', () => {
  if (room && userId) {
    navigator.sendBeacon('signaling.php', `room=${encodeURIComponent(room)}&user=${encodeURIComponent(userId)}&type=leave`);
  }
});

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
  chatMessageCount++;
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
    localVideo.style.opacity = videoOff ? 0.3 : 1.0;
    updateVideoButton();
  };
}
function updateMuteButton() {
  muteBtn.textContent = audioMuted ? "Unmute" : "Mute";
}
function updateVideoButton() {
  videoBtn.textContent = videoOff ? "Video On" : "Video Off";
}

// --- Analytics popup logic ---
if (analyticsBtn) {
  analyticsBtn.onclick = function() {
    showAnalytics();
    analyticsPopup.style.display = "block";
  };
}
if (closeAnalytics) {
  closeAnalytics.onclick = function() {
    analyticsPopup.style.display = "none";
  };
}

function showAnalytics() {
  const now = Date.now();
  const duration = callStartTime ? Math.floor((now - callStartTime) / 1000) : 0;
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const participantCount = users.length;
  let connectionStatsHTML = '';
  const peerIds = Object.keys(peers);
  if (peerIds.length > 0) {
    const pc = peers[peerIds[0]];
    if (pc && pc.getStats) {
      pc.getStats(null).then(stats => {
        let rtt = null, bitrate = null;
        stats.forEach(report => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            if (report.currentRoundTripTime) rtt = report.currentRoundTripTime;
          }
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            if (report.bitrateMean) bitrate = report.bitrateMean;
          }
        });
        let html = '';
        if (rtt) html += `<div><b>RTT:</b> ${(rtt * 1000).toFixed(0)} ms</div>`;
        if (bitrate) html += `<div><b>Video Bitrate:</b> ${(bitrate/1000).toFixed(0)} kbps</div>`;
        analyticsData.innerHTML = `
          <div><b>Call Duration:</b> ${mins}:${secs.toString().padStart(2,'0')}</div>
          <div><b>Participants:</b> ${participantCount}</div>
          <div><b>Chat Messages Sent:</b> ${chatMessageCount}</div>
          ${html}
        `;
      });
      analyticsData.innerHTML = `
        <div><b>Call Duration:</b> ${mins}:${secs.toString().padStart(2,'0')}</div>
        <div><b>Participants:</b> ${participantCount}</div>
        <div><b>Chat Messages Sent:</b> ${chatMessageCount}</div>
        <div style="font-size:13px;color:#888;">(WebRTC connection stats loading...)</div>
      `;
    }
  } else {
    analyticsData.innerHTML = `
      <div><b>Call Duration:</b> ${mins}:${secs.toString().padStart(2,'0')}</div>
      <div><b>Participants:</b> ${participantCount}</div>
      <div><b>Chat Messages Sent:</b> ${chatMessageCount}</div>
    `;
  }
}

// Show incoming call modal
function showIncomingCall(caller) {
  document.getElementById('callerName').textContent = caller;
  document.getElementById('incomingCallModal').style.display = 'flex';
}

// Hide incoming call modal
function hideIncomingCall() {
  document.getElementById('incomingCallModal').style.display = 'none';
}

// Example: Listen for incoming call signals (replace with your signaling logic)
function listenForCalls() {
  setInterval(async () => {
    // Replace with your actual signaling fetch
    const response = await fetch('signaling.php', {
      method: 'POST',
      body: new URLSearchParams({
        type: 'get_signals',
        room: currentRoom,
        user: currentUser
      })
    });
    const signals = await response.json();
    signals.forEach(([from, data]) => {
      try {
        const signal = JSON.parse(data);
        if (signal.type === 'call_offer') {
          showIncomingCall(from);
          // Store caller for later use
          window._incomingCaller = from;
        }
      } catch (e) {}
    });
  }, 2000);
}

// Handle answer/decline
document.getElementById('answerBtn').onclick = async function() {
  hideIncomingCall();
  // Send answer signal (replace with your signaling logic)
  await fetch('signaling.php', {
    method: 'POST',
    body: new URLSearchParams({
      type: 'signal',
      room: currentRoom,
      user: currentUser,
      target: window._incomingCaller,
      data: JSON.stringify({type: 'call_answer'})
    })
  });
  // Start WebRTC connection here
};

document.getElementById('declineBtn').onclick = async function() {
  hideIncomingCall();
  // Send decline signal (replace with your signaling logic)
  await fetch('signaling.php', {
    method: 'POST',
    body: new URLSearchParams({
      type: 'signal',
      room: currentRoom,
      user: currentUser,
      target: window._incomingCaller,
      data: JSON.stringify({type: 'call_decline'})
    })
  });
};

// Account logic
function showLogin() {
  document.getElementById('loginDiv').style.display = '';
  document.getElementById('signupDiv').style.display = 'none';
  document.getElementById('userDiv').style.display = 'none';
}
function showSignup() {
  document.getElementById('loginDiv').style.display = 'none';
  document.getElementById('signupDiv').style.display = '';
  document.getElementById('userDiv').style.display = 'none';
}
function showUser(username) {
  document.getElementById('loginDiv').style.display = 'none';
  document.getElementById('signupDiv').style.display = 'none';
  document.getElementById('userDiv').style.display = '';
  document.getElementById('currentUser').textContent = 'Logged in as: ' + username;
  document.getElementById('mainApp').style.display = '';
}

document.getElementById('showSignupBtn').onclick = showSignup;
document.getElementById('showLoginBtn').onclick = showLogin;

document.getElementById('signupBtn').onclick = async function() {
  const username = document.getElementById('signupUsername').value;
  const password = document.getElementById('signupPassword').value;
  const res = await fetch('accounts.php', {
    method: 'POST',
    body: new URLSearchParams({action:'signup', username, password})
  });
  const data = await res.json();
  if (data.success) {
    showUser(username);
    window.currentUser = username;
  } else {
    document.getElementById('signupError').textContent = data.error || 'Signup failed';
  }
};

document.getElementById('loginBtn').onclick = async function() {
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  const res = await fetch('accounts.php', {
    method: 'POST',
    body: new URLSearchParams({action:'login', username, password})
  });
  const data = await res.json();
  if (data.success) {
    showUser(username);
    window.currentUser = username;
  } else {
    document.getElementById('loginError').textContent = data.error || 'Login failed';
  }
};

document.getElementById('logoutBtn').onclick = function() {
  window.currentUser = null;
  document.getElementById('mainApp').style.display = 'none';
  showLogin();
};

// On page load, show login
showLogin();