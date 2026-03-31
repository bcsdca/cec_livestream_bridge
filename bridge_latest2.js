// bridge.js (Smart Cached Version - Auto Exit When Finished)

const osc = require("osc");
const { YOUTUBE_API_KEY, CHANNEL_ID, POLL_INTERVAL_MS } = require("./config");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

/* ===============================
   LANGUAGE PORT CONFIG
================================= */
const languages = {
  cantonese: { remotePort: 8000, localPort: 9000 },
  english:   { remotePort: 8001, localPort: 9001 },
  mandarin:  { remotePort: 8002, localPort: 9002 },
  joint:     { remotePort: 8003, localPort: 9003 }
};

const udpPorts = {};
const streamCache = {};
const streamEnded = {};
const lockLogged = {};

/* ===============================
   QUOTA TRACKING
================================= */
let quotaUsed = 0;

/* 🔥 TRACK IF ANY STREAM EVER STARTED */
let hasStarted = false;

/* ===============================
   CREATE OSC PORTS
================================= */
for (const [lang, portInfo] of Object.entries(languages)) {

  streamCache[lang] = null;
  streamEnded[lang] = false;
  lockLogged[lang] = false;

  const udpPort = new osc.UDPPort({
    localAddress: "127.0.0.1",
    localPort: portInfo.localPort,
    remoteAddress: "127.0.0.1",
    remotePort: portInfo.remotePort
  });

  udpPort.open();
  udpPorts[lang] = udpPort;

  udpPort.on("ready", () => {
    udpPort.send({
      address: `/livestream/${lang}`,
      args: [{ type: "s", value: "none" }]
    });
  });
}

/* ===============================
   SEARCH FOR STREAM
================================= */
async function searchForStream(lang) {

  const eventTypes = ["upcoming", "live"];

  for (const type of eventTypes) {

    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search` +
      `?part=snippet` +
      `&channelId=${CHANNEL_ID}` +
      `&type=video` +
      `&eventType=${type}` +
      `&maxResults=10` +
      `&key=${YOUTUBE_API_KEY}`;

    quotaUsed += 100;

    const res = await fetch(searchUrl);
    if (!res.ok) return null;

    const data = await res.json();

    for (const item of data.items || []) {

      const title = item.snippet.title.toLowerCase();

      if (title.includes(lang)) {
        return item.id.videoId;
      }
    }
  }

  return null;
}

/* ===============================
   GET VIDEO STATUS
================================= */
async function getVideoStatus(videoId) {

  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,statistics,liveStreamingDetails` +
    `&id=${videoId}` +
    `&key=${YOUTUBE_API_KEY}`;

  quotaUsed += 1;

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.items || data.items.length === 0) return null;

  const video = data.items[0];

  return {
    state: video.snippet.liveBroadcastContent,
    concurrent: Number(video.liveStreamingDetails?.concurrentViewers || 0)
  };
}

/* ===============================
   SEND OSC
================================= */
function sendOSC(lang, value) {

  udpPorts[lang].send({
    address: `/livestream/${lang}`,
    args: [{ type: "s", value }]
  });

  console.log(
    new Date().toLocaleTimeString(),
    `→ ${lang}:`,
    value.replace("\n", " | ")
  );
}

/* ===============================
   MAIN POLL LOOP
================================= */
async function pollLivestream() {

  let allNone = true;

  for (const lang of Object.keys(languages)) {

    if (streamEnded[lang]) continue;

    if (!streamCache[lang]) {

      const foundVideoId = await searchForStream(lang);

      if (foundVideoId) {
        streamCache[lang] = foundVideoId;
      } else {
        sendOSC(lang, "none");
        continue;
      }
    }

    const status = await getVideoStatus(streamCache[lang]);

    if (!status) {
      sendOSC(lang, "none");
      continue;
    }

    const { state, concurrent } = status;

    if (state === "live") {

      hasStarted = true;  // 🔥 mark started
      allNone = false;

      const value = `live\n👀 ${concurrent}`;
      sendOSC(lang, value);

      if (!lockLogged[lang]) {
        console.log(`🔒 Locked ${lang} → ${streamCache[lang]}`);
        lockLogged[lang] = true;
      }

    } else if (state === "upcoming") {

      hasStarted = true;  // 🔥 mark started
      allNone = false;

      sendOSC(lang, "upcoming");

      if (!lockLogged[lang]) {
        console.log(`🔒 Locked ${lang} → ${streamCache[lang]}`);
        lockLogged[lang] = true;
      }

    } else {

      console.log(`🛑 ${lang} stream just ended.`);
      sendOSC(lang, "none");

      streamCache[lang] = null;
      streamEnded[lang] = true;
    }
  }

  console.log("Quota used so far:", quotaUsed);
  console.log("----");

  /* 🔥 AUTO EXIT LOGIC */
  if (hasStarted && allNone) {
    console.log("✅ All streams finished. Exiting bridge.");
    process.exit(0);
  }
}

/* ===============================
   START
================================= */
pollLivestream();
setInterval(pollLivestream, POLL_INTERVAL_MS);
