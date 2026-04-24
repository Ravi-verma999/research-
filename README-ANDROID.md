# Android Setup Guide

This application is fully capable of running offline on your Android device! It stores your books and extracted knowledge in a local database (`.data/store.json`) and uses local AI models for both embedding and question-answering when offline or when an API key is not provided.

### Prerequisites (Termux)
To run this application on Android, you will need to install **Termux**, a free terminal emulator for Android.
1. Download **Termux** from F-Droid (the Google Play Store version is no longer updated).
2. Open Termux.

### Installation
Run the following commands in Termux to set up the environment:

```bash
# Update packages
pkg update && pkg upgrade -y

# Install Node.js, Git, and python/build tools (needed for some modules)
pkg install nodejs git python make clang build-essential -y

# Clone your project or transfer the folder to your phone
# If transferring via internal storage, run: termux-setup-storage
# and copy the folder from ~/storage/shared/... to your termux home.
```

### Running the App
Once you have the code on your Termux:

```bash
# 1. Enter the project folder
cd your-project-folder

# 2. Install dependencies
npm install

# 3. Build the application
npm run build

# 4. Start the server
npm run start
```

### Accessing the App
After the server starts, it will say `Server running on http://localhost:3000`.
- **To use on your phone:** Open your Android web browser (Chrome, Firefox) and go to `http://localhost:3000`.
- **To use on another device on the same WiFi:** Find your Android phone's IP address (e.g., `192.168.1.15`) and go to `http://192.168.1.15:3000` on your laptop's browser.

## 4. Self-Learning Online Knowledge
Even without API keys, this app is now configured to automatically search the internet if it cannot find answers in its local database. 
- It uses DuckDuckGo to scrape top websites.
- Reads information, adds it to the local `.data/store.json`.
- Uses local Transformer AI models to vectorize and answer. 
- Over time, your local offline database will permanently remember everything it searched for online!
