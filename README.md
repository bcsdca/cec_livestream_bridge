CEC Livestream Bridge
The CEC Livestream Bridge is a lightweight Node.js service designed to coordinate and monitor multiple livestream sessions.
It works alongside the livestream scheduling system and integrates with Bitfocus Companion via OSC (Open Sound Control) to provide real-time stream status and control.

Features
	•	Monitor multiple livestream services simultaneously
	•	Display real-time livestream status
	•	Show concurrent viewer count when a stream is live
	•	Provide Join control for available livestreams
	•	Lightweight and efficient Node.js implementation
	•	Seamless integration with Bitfocus Companion via OSC

Why OSC?
This project uses OSC (Open Sound Control) for communication with Bitfocus Companion because:
	•	It is simple and efficient
	•	It supports real-time message updates
	•	It allows sending rich data (e.g., viewer count, stream status)
Compared to HTTP endpoints:
	•	HTTP typically only confirms connection status
	•	OSC allows actual data communication from the YouTube API to Companion buttons

Requirements
	•	Node.js (v18+ recommended)
	•	npm

Installation
Clone the repository:
git clone https://github.com/bcsdca/cec_livestream_bridge.git
cd cec_livestream_bridge
Install dependencies:
npm install

Configuration
Create a config.js file in the root directory:
export default {
  apiKey: "YOUR_API_KEY",
  channelId: "YOUR_CHANNEL_ID"
};
Important:
	•	config.js is excluded from version control for security reasons
	•	Do not commit API keys or sensitive data

Running the Service
node bridge.js

Scheduling (macOS)
This service is typically scheduled using launchd:
	•	Start: Sunday 9:00 AM
	•	Stop: Sunday 12:30 PM

Logs
Logs are written to:
bridge.log

Notes
	•	Keep config.js local and secure
	•	Do not expose API credentials
	•	Consider using environment variables for production

Related Project
	•	cec_livestream_scheduling â€” manages stream scheduling and orchestration

Author
CEC Broadcast Team
