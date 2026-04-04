// bridge.js (Smart Cached + Multi-Joint + Today Filter)

const osc = require("osc");
const { YOUTUBE_API_KEY, CHANNEL_ID, POLL_INTERVAL_MS } = require("./config");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

/* =============================== */
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

let quotaUsed = 0;
let hasStarted = false;

let englishEverLive = false;
let mandarinEverLive = false;
let jointEverLive = false;

const usedVideoIds = new Set();

/* ===============================
   📅 TODAY + TOMORROW HELPER
================================= */
const today = new Date();

const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);

const todayStr = today.toDateString();
const tomorrowStr = tomorrow.toDateString();

function isTodayOrTomorrow(dateString) {
  if (!dateString) return false;

  const d = new Date(dateString).toDateString();

  return d === todayStr || d === tomorrowStr;
}

/* =============================== */
for (const [lang, portInfo] of Object.entries(languages)) {

  streamCache[lang] = (lang === "joint") ? [] : null;
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
    if (!res.ok) return;

    const data = await res.json();

    const videoIds = (data.items || []).map(i => i.id.videoId).filter(Boolean);
    if (videoIds.length === 0) continue;

    /* 🔥 GET DETAILS FOR DATE FILTER */
    const detailsUrl =
      `https://www.googleapis.com/youtube/v3/videos` +
      `?part=snippet,liveStreamingDetails` +
      `&id=${videoIds.join(",")}` +
      `&key=${YOUTUBE_API_KEY}`;

    quotaUsed += 1;

    const detailsRes = await fetch(detailsUrl);
    if (!detailsRes.ok) continue;

    const detailsData = await detailsRes.json();

    for (const video of detailsData.items || []) {

      const title = video.snippet.title.toLowerCase();
      const videoId = video.id;
      const scheduled = video.liveStreamingDetails?.scheduledStartTime;

      /* 🔥 TODAY or TOMORROW FILTER */
      if (!isTodayOrTomorrow(scheduled)) continue; 

      /* 🔥 JOINT PRIORITY */
      if (title.includes("joint")) {

        if (lang === "joint" && !usedVideoIds.has(videoId)) {
          usedVideoIds.add(videoId);
          streamCache["joint"].push(videoId);
        }

        continue;
      }

      /* 🔥 NORMAL LANGUAGE */
      if (title.includes(lang) && !usedVideoIds.has(videoId)) {
        usedVideoIds.add(videoId);
        streamCache[lang] = videoId;
        return;
      }
    }
  }
}

/* =============================== */
async function getVideoStatus(videoId) {

  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,liveStreamingDetails` +
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

/* =============================== */
function sendOSC(lang, value) {

  udpPorts[lang].send({
    address: `/livestream/${lang}`,
    args: [{ type: "s", value }]
  });

  console.log(
    new Date().toLocaleString(),
    `→ ${lang}:`,
    value.replace("\n", " | ")
  );
}

/* =============================== */
async function pollLivestream() {

  let allNone = true;

  for (const lang of Object.keys(languages)) {

    if (streamEnded[lang]) continue;

    if (lang === "joint") {
      await searchForStream("joint");
    } else if (!streamCache[lang]) {

      await searchForStream(lang);

      if (!streamCache[lang]) {
        sendOSC(lang, "none");
        continue;
      }
    }

    let status = null;
    let selectedVideoId = null;

    if (lang === "joint") {

      console.log("📦 Joint cache:", streamCache["joint"]);

      for (const vid of streamCache["joint"]) {

        const s = await getVideoStatus(vid);
        if (!s) continue;

        if (s.state === "live") {
          status = s;
          selectedVideoId = vid;
          break;
        }

        if (s.state === "upcoming" && !status) {
          status = s;
          selectedVideoId = vid;
        }
      }

      if (!status) {
        sendOSC(lang, "none");
        continue;
      }

    } else {

      const s = await getVideoStatus(streamCache[lang]);

      if (!s) {
        sendOSC(lang, "none");
        continue;
      }

      status = s;
      selectedVideoId = streamCache[lang];
    }

    const { state, concurrent } = status;

    if (state === "live") {

      hasStarted = true;
      allNone = false;

      if (lang === "english") englishEverLive = true;
      if (lang === "mandarin") mandarinEverLive = true;

      if (lang === "joint") {
        jointEverLive = true;

        console.log("🛑 Joint live detected. Disabling other streams.");

        ["english", "mandarin", "cantonese"].forEach(other => {
          streamEnded[other] = true;
          streamCache[other] = null;
        });
      }

      sendOSC(lang, `live\n👀 ${concurrent}`);

      if (!lockLogged[lang]) {
        console.log(`🔒 Locked ${lang} → ${selectedVideoId}`);
        lockLogged[lang] = true;
      }

    } else if (state === "upcoming") {

      hasStarted = true;
      allNone = false;

      sendOSC(lang, "upcoming");

      if (!lockLogged[lang]) {
        console.log(`🔒 Locked ${lang} → ${selectedVideoId}`);
        lockLogged[lang] = true;
      }

    } else {

      console.log(`🛑 ${lang} stream just ended.`);
      sendOSC(lang, "none");

      streamCache[lang] = (lang === "joint") ? [] : null;
      streamEnded[lang] = true;
    }
  }

  console.log("Quota used so far:", quotaUsed);
  console.log("----");

  if (hasStarted) {
    const allEnded = Object.values(streamEnded).every(v => v === true);

    if (allEnded) {
      console.log("✅ All streams finished. Exiting bridge.");

      setTimeout(() => process.exit(0), 500);
    }
  }
}

/* =============================== */
pollLivestream();
setInterval(pollLivestream, POLL_INTERVAL_MS);
