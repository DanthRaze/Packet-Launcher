# Packet Launcher 🚀

Welcome to the **Packet Launcher** repository. This is a full-scale, cross-platform Minecraft launcher built with Rust, Tauri v2, React, and Tailwind CSS. 

The aesthetic is a sleek, deep-dark "Techno" theme (`#0b0b0b` background with `#8b5cf6` purple accents), featuring a 3D skin viewer, Modrinth integration, and a Google Sheets-powered CMS for news and updates.

---

## 🛠️ Beginner Setup Guide

Follow these instructions exactly to get your development environment running on macOS or Windows.

### 1. Install Prerequisites

#### On macOS
1. Open your Terminal.
2. **Install Homebrew** (if you don't have it):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```
3. **Install Node.js & npm**:
   ```bash
   brew install node
   ```
4. **Install Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   Restart your terminal after installation.

#### On Windows
1. Download and install **Node.js** from [nodejs.org](https://nodejs.org/).
2. Download and install **Rust** from [rustup.rs](https://rustup.rs/).
3. Install the **C++ Build Tools**: Download Visual Studio Community, and during setup, select the "Desktop development with C++" workload.

### 2. VS Code Environment
1. Download and install **Visual Studio Code**.
2. Open VS Code, go to the Extensions panel (`Ctrl+Shift+X` / `Cmd+Shift+X`), and install:
   - **rust-analyzer** (For Rust code completion)
   - **Tauri** (Official Tauri extension)
   - **Tailwind CSS IntelliSense** (For Tailwind styling)

### 3. Running the Project Locally
I have already generated the entire project scaffolding, pages, and UI for you in this directory!

To start the application locally:
1. Open a terminal in the `PacketLauncher` folder.
2. Install the JavaScript dependencies (if they aren't already):
   ```bash
   npm install
   ```
3. Run the Tauri development server:
   ```bash
   npm run tauri dev
   ```
   *Note: The first time you run this, Rust will download and compile many crates. This can take 5-10 minutes. Subsequent builds will be very fast.*

---

## ☁️ Google Sheets CMS Backend

We use Google Sheets as a free, lightweight CMS for the News Feed on the Home Page. 

1. Create a new Google Sheet. Rename the first tab to `News`.
2. In the first row, add the exact headers: `id`, `title`, `shortDescription`, `image`, `longDescription`.
3. Add a row of dummy data. Use an image URL for the `image` column.
4. Open the `CMS_Apps_Script.js` file provided in this folder.
5. In your Google Sheet, go to **Extensions -> Apps Script**.
6. Paste the contents of `CMS_Apps_Script.js` into `Code.gs`.
7. **Important:** Replace `YOUR_SHEET_ID` in the code with the ID from your Sheet's URL.
8. Click **Deploy -> New Deployment**.
9. Select type **Web app**. Execute as: **Me**. Who has access: **Anyone**.
10. Deploy and authorize. You will receive a **Web App URL**. This URL returns your sheet data as JSON!
11. Update the `src/pages/Home.tsx` file to fetch from this URL instead of using the dummy data.

---

## 📦 Cross-Platform Distribution (.dmg / .exe)

Tauri v2 makes distribution incredibly easy. To build the installer for your current platform (e.g., building a `.dmg` on Mac or `.msi/.exe` on Windows):

1. Edit `src-tauri/tauri.conf.json`. Ensure your `identifier` is unique (e.g., `com.yourname.packetlauncher`).
2. Run the build command:
   ```bash
   npm run tauri build
   ```
3. The built installers will be located in `src-tauri/target/release/bundle/`.

### GitHub Actions (Automated Builds)
To build for macOS and Windows automatically, you can use GitHub Actions. Create a `.github/workflows/build.yml` file in your repository:

```yaml
name: Release
on:
  push:
    tags:
      - 'v*'
jobs:
  build:
    strategy:
      matrix:
        platform: [macos-latest, windows-latest]
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - name: setup node
        uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: install Rust stable
        uses: dtolnay/rust-toolchain@stable
      - name: install web dependencies
        run: npm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Next Steps for Development
- **Authentication**: You must register an Azure AD Application to get a Client ID for real Microsoft OAuth. Update the `start_microsoft_oauth` function in `src-tauri/src/lib.rs`.
- **Minecraft Core**: The `start_minecraft_instance` command in Rust currently just sleeps for 10 seconds. You will need to implement real file I/O to download libraries, assets, and spawn the Java process using `std::process::Command`.
