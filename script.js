let localStream, remoteStream, peer, room;
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');

joinBtn.onclick = async function() {
  room = roomInput.value;
  await start();
};

async function start() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  peer = new RTCPeerConnection();

  peer.onicecandidate = e => {
    if (e.candidate) sendSignal('candidate', JSON.stringify(e.candidate));
  };

  peer.ontrack = e => {
    remoteVideo.srcObject = e.streams[0];
  };

  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  if (location.hash !== '#joined') {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    sendSignal('offer', JSON.stringify(offer));
    location.hash = '#joined';
    pollSignal();
  } else {
    pollSignal();
  }
}

function sendSignal(type, data) {
  fetch('signaling.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `room=${encodeURIComponent(room)}&type=${type}&data=${encodeURIComponent(data)}`
  });
}

async function pollSignal() {
  setInterval(async () => {
    const res = await fetch('signaling.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: `room=${encodeURIComponent(room)}&type=get`
    });
    const text = await res.text();
    if (!text) return;
    text.trim().split('\n').forEach(async line => {
      const [type, data] = line.split('|');
      if (type === 'offer') {
        await peer.setRemoteDescription(new RTCSessionDescription(JSON.parse(data)));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        sendSignal('answer', JSON.stringify(answer));
      } else if (type === 'answer') {
        await peer.setRemoteDescription(new RTCSessionDescription(JSON.parse(data)));
      } else if (type === 'candidate') {
        try {
          await peer.addIceCandidate(new RTCIceCandidate(JSON.parse(data)));
        } catch (e) {}
      }
    });
  }, 1000);
}