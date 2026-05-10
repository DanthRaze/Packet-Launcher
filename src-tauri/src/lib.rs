use tauri::{command, AppHandle, Emitter};
use std::thread;
use std::time::Duration;
use std::path::PathBuf;
use std::fs;
use std::net::TcpListener;
use std::io::{Read, Write};
use sysinfo::System;
use directories::ProjectDirs;
use serde::{Serialize, Deserialize};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use futures_util::StreamExt;
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use lazy_static::lazy_static;
use base64::Engine as _;

// ─── Global State ────────────────────────────────────────────────────────────
lazy_static! {
    static ref DISCORD_CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
    static ref RUNNING_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);
}

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct InstanceMeta {
    pub name: String,
    pub instance_type: String,
    pub version: String,
    pub last_played: String,
    #[serde(default)]
    pub favourite: bool,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MinecraftProfile {
    pub uuid: String,
    pub username: String,
    pub skin_url: String,
    pub access_token: String,
}

#[derive(Serialize, Clone)]
struct DownloadProgress {
    id: String,
    name: String,
    downloaded: u64,
    total: u64,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


fn data_dir() -> PathBuf {
    let p = ProjectDirs::from("com", "packetlauncher", "app")
        .expect("Could not get project dirs");
    let d = p.data_dir().to_path_buf();
    fs::create_dir_all(&d).ok();
    d
}

fn instances_dir() -> PathBuf {
    let d = data_dir().join("instances");
    fs::create_dir_all(&d).ok();
    d
}

// ─── Instances ───────────────────────────────────────────────────────────────

#[command]
fn list_instances() -> Result<Vec<InstanceMeta>, String> {
    let mut list = Vec::new();
    if let Ok(entries) = fs::read_dir(instances_dir()) {
        for e in entries.flatten() {
            let p = e.path().join("instance.json");
            if p.exists() {
                if let Ok(s) = fs::read_to_string(p) {
                    if let Ok(m) = serde_json::from_str::<InstanceMeta>(&s) {
                        list.push(m);
                    }
                }
            }
        }
    }
    Ok(list)
}

#[command]
fn create_instance(name: String, instance_type: String, version: String) -> Result<InstanceMeta, String> {
    let dir = instances_dir().join(&name);
    if dir.exists() { return Err("Instance already exists".into()); }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for sub in &["mods", "resourcepacks", "shaderpacks", "saves", "screenshots"] {
        fs::create_dir_all(dir.join(sub)).ok();
    }
    let meta = InstanceMeta { name, instance_type, version, last_played: "Never".into(), favourite: false, pinned: false };
    fs::write(dir.join("instance.json"), serde_json::to_string_pretty(&meta).unwrap()).map_err(|e| e.to_string())?;
    Ok(meta)
}

#[command]
fn set_pinned_instance(name: String) -> Result<(), String> {
    if let Ok(entries) = fs::read_dir(instances_dir()) {
        for e in entries.flatten() {
            let p = e.path().join("instance.json");
            if p.exists() {
                if let Ok(s) = fs::read_to_string(&p) {
                    if let Ok(mut m) = serde_json::from_str::<InstanceMeta>(&s) {
                        m.pinned = m.name == name;
                        let _ = fs::write(&p, serde_json::to_string_pretty(&m).unwrap());
                    }
                }
            }
        }
    }
    Ok(())
}

#[command]
fn toggle_favourite(name: String) -> Result<bool, String> {
    let p = instances_dir().join(&name).join("instance.json");
    let mut m: InstanceMeta = serde_json::from_str(&fs::read_to_string(&p).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    m.favourite = !m.favourite;
    let val = m.favourite;
    fs::write(&p, serde_json::to_string_pretty(&m).unwrap()).map_err(|e| e.to_string())?;
    Ok(val)
}

#[command]
fn delete_instance(name: String) -> Result<(), String> {
    let dir = instances_dir().join(&name);
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[command]
fn open_instance_folder(name: String) -> Result<(), String> {
    let dir = instances_dir().join(&name);
    if dir.exists() {
        let _ = tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>);
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ContentMeta {
    pub filename: String,
    pub name: String,
    pub icon_url: Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct ScreenshotInfo {
    pub filename: String,
    pub instance_name: String,
    pub file_path: String,
    pub modified_time: u64,
    pub file_size: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct LaunchStatus {
    pub status: String,
    pub instance_name: String,
}

#[command]
fn list_instance_contents(name: String, folder: String) -> Result<Vec<ContentMeta>, String> {
    let dir = instances_dir().join(&name).join(&folder);
    if !dir.exists() { return Ok(Vec::new()); }
    
    // Load metadata if exists
    let meta_path = instances_dir().join(&name).join(format!("{}_metadata.json", folder));
    let metadata: Vec<ContentMeta> = if meta_path.exists() {
        serde_json::from_str(&fs::read_to_string(meta_path).unwrap_or_default()).unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut result = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            if e.path().is_file() {
                let filename = e.file_name().to_string_lossy().to_string();
                if filename == "metadata.json" || filename.starts_with('.') { continue; }
                
                // Find in metadata or create basic
                let m = metadata.iter().find(|m| m.filename == filename)
                    .cloned()
                    .unwrap_or(ContentMeta {
                        filename,
                        name: e.file_name().to_string_lossy().to_string(),
                        icon_url: None,
                        description: None,
                    });
                result.push(m);
            }
        }
    }
    Ok(result)
}

#[command]
fn list_screenshots() -> Result<Vec<ScreenshotInfo>, String> {
    let mut screenshots = Vec::new();
    
    if let Ok(instances_entries) = fs::read_dir(instances_dir()) {
        for instance_entry in instances_entries.flatten() {
            let instance_name = instance_entry.file_name().to_string_lossy().to_string();
            let screenshots_dir = instance_entry.path().join("screenshots");
            
            if screenshots_dir.exists() {
                if let Ok(screenshot_entries) = fs::read_dir(screenshots_dir) {
                    for screenshot_entry in screenshot_entries.flatten() {
                        let path = screenshot_entry.path();
                        if path.is_file() {
                            let filename = path.file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("unknown")
                                .to_string();
                            
                            // Only include image files
                            if filename.to_lowercase().ends_with(".png") || 
                               filename.to_lowercase().ends_with(".jpg") || 
                               filename.to_lowercase().ends_with(".jpeg") {
                                
                                let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                                let modified_time = metadata.modified()
                                    .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
                                    .unwrap_or(0);
                                let file_size = metadata.len();
                                
                                screenshots.push(ScreenshotInfo {
                                    filename,
                                    instance_name: instance_name.clone(),
                                    file_path: path.to_string_lossy().to_string(),
                                    modified_time,
                                    file_size,
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Sort by modified time (newest first)
    screenshots.sort_by(|a, b| b.modified_time.cmp(&a.modified_time));
    Ok(screenshots)
}


#[command]
fn stop_game() -> Result<(), String> {
    let mut process = RUNNING_PROCESS.lock().unwrap();
    if let Some(mut child) = process.take() {
        match child.kill() {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Failed to stop game: {}", e))
        }
    } else {
        Err("No game is currently running".into())
    }
}

#[command]
fn is_game_running() -> Result<bool, String> {
    let process = RUNNING_PROCESS.lock().unwrap();
    Ok(process.is_some())
}

#[command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[command]
async fn get_screenshot_base64(file_path: String) -> Result<String, String> {
    if !std::path::Path::new(&file_path).exists() {
        return Err("Screenshot file not found".into());
    }
    
    let image_data = fs::read(&file_path).map_err(|e| e.to_string())?;
    let base64_string = base64::engine::general_purpose::STANDARD.encode(&image_data);
    
    // Determine file extension for data URL
    let extension = if file_path.to_lowercase().ends_with(".png") {
        "png"
    } else if file_path.to_lowercase().ends_with(".jpg") || file_path.to_lowercase().ends_with(".jpeg") {
        "jpg"
    } else {
        "png" // default
    };
    
    Ok(format!("data:image/{};base64,{}", extension, base64_string))
}

// ─── Downloads ───────────────────────────────────────────────────────────────

#[command]
async fn download_file(app: AppHandle, url: String, instance_name: String, target_folder: String, filename: String, download_id: String, metadata: Option<Value>) -> Result<String, String> {
    let dir = instances_dir().join(&instance_name).join(&target_folder);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_path = dir.join(&filename);
    let mut file = tokio::fs::File::create(&file_path).await.map_err(|e| e.to_string())?;
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let display_name = download_id.split('|').nth(1).unwrap_or(&filename).to_string();
    
    // Save metadata if provided
    if let Some(m) = metadata {
        let meta_path = instances_dir().join(&instance_name).join(format!("{}_metadata.json", target_folder));
        let mut all_meta: Vec<ContentMeta> = if meta_path.exists() {
            serde_json::from_str(&fs::read_to_string(&meta_path).unwrap_or_default()).unwrap_or_default()
        } else {
            Vec::new()
        };
        
        let new_meta = ContentMeta {
            filename: filename.clone(),
            name: m["name"].as_str().unwrap_or(&display_name).to_string(),
            icon_url: m["icon_url"].as_str().map(|s| s.to_string()),
            description: m["description"].as_str().map(|s| s.to_string()),
        };
        
        all_meta.retain(|x| x.filename != filename);
        all_meta.push(new_meta);
        let _ = fs::write(meta_path, serde_json::to_string_pretty(&all_meta).unwrap());
    }

    let mut stream = resp.bytes_stream();
    let mut done = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        let _ = app.emit("download_progress", DownloadProgress { id: download_id.clone(), name: display_name.clone(), downloaded: done, total });
    }
    Ok(file_path.to_string_lossy().to_string())
}

// ─── Microsoft / Minecraft Auth ──────────────────────────────────────────────

#[command]
fn start_microsoft_oauth() -> Result<MinecraftProfile, String> {
    let client_id = "0a899e0e-9545-4430-82ca-5082b8ea180c";
    let redirect_uri = "http://localhost:3456/callback";
    let auth_url = format!(
        "https://login.live.com/oauth20_authorize.srf?client_id={}&response_type=code&redirect_uri={}&scope=XboxLive.signin%20offline_access&prompt=select_account&cobrandid=8058fde8-aa06-4c1b-b93f-73148efc4c05",
        client_id, redirect_uri
    );
    let _ = tauri_plugin_opener::open_url(&auth_url, None::<&str>);

    // Loopback capture
    let listener = TcpListener::bind("127.0.0.1:3456").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).unwrap();
    let mut code = String::new();
    let start = std::time::Instant::now();
    while start.elapsed() < Duration::from_secs(120) {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 4096];
            if let Ok(n) = stream.read(&mut buf) {
                let req = String::from_utf8_lossy(&buf[..n]);
                if let Some(i) = req.find("code=") {
                    let rest = &req[i + 5..];
                    let end = rest.find(|c: char| c == ' ' || c == '&').unwrap_or(rest.len());
                    code = rest[..end].to_string();
                }
                let page = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body style='background:#0a0a0a;color:#f1f0f7;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;'><h2 style='color:#8b5cf6'>Authenticated! You may close this tab.</h2></body></html>";
                let _ = stream.write_all(page);
                break;
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    if code.is_empty() { return Err("Auth timed out or was cancelled".into()); }

    let http = reqwest::blocking::Client::new();

    // MS token
    let ms: Value = http.post("https://login.live.com/oauth20_token.srf")
        .form(&[("client_id", client_id), ("code", &code), ("grant_type", "authorization_code"), ("redirect_uri", redirect_uri)])
        .send().map_err(|e| e.to_string())?.json().map_err(|e| e.to_string())?;
    let ms_token = ms["access_token"].as_str().ok_or("No MS access token")?;

    // XBL
    let xbl: Value = http.post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={}", ms_token) }, "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT" }))
        .send().map_err(|e| e.to_string())?.json().map_err(|e| e.to_string())?;
    let xbl_token = xbl["Token"].as_str().ok_or("No XBL token")?;
    let uhs = xbl["DisplayClaims"]["xui"][0]["uhs"].as_str().ok_or("No userhash")?;

    // XSTS
    let xsts: Value = http.post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Accept", "application/json")
        .json(&serde_json::json!({ "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] }, "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT" }))
        .send().map_err(|e| e.to_string())?.json().map_err(|e| e.to_string())?;
    let xsts_token = xsts["Token"].as_str().ok_or("No XSTS token")?;

    // Minecraft token
    let mc_resp = http.post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&serde_json::json!({ "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token) }))
        .send().map_err(|e| e.to_string())?;
    
    if !mc_resp.status().is_success() {
        let err: Value = mc_resp.json().unwrap_or_default();
        let msg = err["errorMessage"].as_str().unwrap_or("Unknown error");
        if msg.contains("NOT_FOUND") || msg.contains("no profile") {
            return Err("Minecraft profile not found. Please create one at https://www.minecraft.net/msaprofile/".into());
        }
        return Err(format!("Minecraft Login Failed: {}", msg));
    }
    
    let mc: Value = mc_resp.json().map_err(|e| e.to_string())?;
    let mc_token = mc["access_token"].as_str().ok_or("No Minecraft access token in response")?;

    // Profile
    let profile: Value = http.get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(mc_token).send().map_err(|e| e.to_string())?.json().map_err(|e| e.to_string())?;
    let uuid = profile["id"].as_str().ok_or("No UUID")?;
    let username = profile["name"].as_str().ok_or("No username")?;
    let skin_url = profile["skins"].as_array()
        .and_then(|s| s.iter().find(|s| s["state"] == "ACTIVE"))
        .and_then(|s| s["url"].as_str())
        .unwrap_or("https://mineskin.eu/skin/steve")
        .to_string();

    let result = MinecraftProfile { uuid: uuid.into(), username: username.into(), skin_url, access_token: mc_token.into() };
    let _ = fs::write(data_dir().join("profile.json"), serde_json::to_string_pretty(&result).unwrap());
    Ok(result)
}

#[command]
fn get_saved_profile() -> Option<MinecraftProfile> {
    let p = data_dir().join("profile.json");
    if p.exists() {
        serde_json::from_str(&fs::read_to_string(p).ok()?).ok()
    } else { None }
}

#[command]
fn set_discord_rpc(enabled: bool) -> Result<(), String> {
    let mut client_lock = DISCORD_CLIENT.lock().unwrap();
    
    if !enabled {
        if let Some(mut client) = client_lock.take() {
            let _ = client.close();
        }
        return Ok(());
    }

    if client_lock.is_none() {
        let mut client = DiscordIpcClient::new("1348123456789012345");
        if client.connect().is_ok() {
            *client_lock = Some(client);
        }
    }

    if let Some(client) = client_lock.as_mut() {
        let _ = client.set_activity(discord_rich_presence::activity::Activity::new()
            .state("Main Menu")
            .details("Launching Minecraft")
            .assets(discord_rich_presence::activity::Assets::new()
                .large_image("logo")
                .large_text("Packet Launcher"))
        );
    }
    Ok(())
}

#[command]
fn update_discord_rpc(state: String, details: String) -> Result<(), String> {
    let mut client_lock = DISCORD_CLIENT.lock().unwrap();
    if let Some(client) = client_lock.as_mut() {
        let _ = client.set_activity(discord_rich_presence::activity::Activity::new()
            .state(&state)
            .details(&details)
            .assets(discord_rich_presence::activity::Assets::new()
                .large_image("logo")
                .large_text("Packet Launcher"))
        );
    }
    Ok(())
}

#[command]
async fn upload_skin(data: Vec<u8>) -> Result<String, String> {
    let profile_path = data_dir().join("profile.json");
    if !profile_path.exists() { return Err("Not logged in".into()); }
    let profile: MinecraftProfile = serde_json::from_str(&fs::read_to_string(&profile_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;

    let client = reqwest::Client::new();
    
    // Multipart form upload
    let form = reqwest::multipart::Form::new()
        .part("file", reqwest::multipart::Part::bytes(data).file_name("skin.png").mime_str("image/png").map_err(|e| e.to_string())?)
        .text("variant", "classic");

    let resp = client.post("https://api.minecraftservices.com/minecraft/profile/skins")
        .bearer_auth(&profile.access_token)
        .multipart(form)
        .send().await.map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        // Refresh saved profile
        let mut updated = profile.clone();
        let new_p: Value = client.get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(&profile.access_token).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        
        if let Some(url) = new_p["skins"].as_array().and_then(|s| s.iter().find(|x| x["state"] == "ACTIVE")).and_then(|x| x["url"].as_str()) {
            updated.skin_url = url.to_string();
            let _ = fs::write(data_dir().join("profile.json"), serde_json::to_string_pretty(&updated).unwrap());
        }
        Ok("Skin uploaded successfully!".into())
    } else {
        let err: Value = resp.json().await.unwrap_or_default();
        Err(err["errorMessage"].as_str().unwrap_or("Failed to upload skin").to_string())
    }
}

#[command]
fn purge_cache() -> Result<(), String> {
    let d = data_dir();
    if let Ok(entries) = fs::read_dir(d) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name == "instances" || name == "profile.json" { continue; }
            if e.path().is_dir() { let _ = fs::remove_dir_all(e.path()); }
            else { let _ = fs::remove_file(e.path()); }
        }
    }
    Ok(())
}

#[command]
fn delete_saved_profile() -> Result<(), String> {
    let p = data_dir().join("profile.json");
    if p.exists() { fs::remove_file(p).map_err(|e| e.to_string())?; }
    Ok(())
}


// ─── Launch Game ─────────────────────────────────────────────────────────────

#[command]
async fn launch_instance(app: AppHandle, instance_name: String, allocated_ram_gb: u32, developer_mode: bool) -> Result<(), String> {
    
    let profile: MinecraftProfile = if developer_mode {
        // Use offline/developer credentials for testing
        MinecraftProfile {
            uuid: "01234567-89ab-cdef-0123-456789abcdef".to_string(),
            username: "Developer".to_string(),
            skin_url: "https://mineskin.eu/skin/steve".to_string(),
            access_token: "offline_token".to_string(),
        }
    } else {
        // Normal authentication flow
        let profile_path = data_dir().join("profile.json");
        if !profile_path.exists() { 
            return Err("Not logged in. Sign in with Microsoft first.".into()); 
        }
        serde_json::from_str(&fs::read_to_string(&profile_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?
    };

    let instance_dir = instances_dir().join(&instance_name);
    let meta: InstanceMeta = serde_json::from_str(&fs::read_to_string(instance_dir.join("instance.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let version = &meta.version;
    
    println!("=== LAUNCHING INSTANCE: {} (type: {}, version: {}) ===", instance_name, meta.instance_type, version);
    println!("Debug: Native library extraction starting...");

    let version_dir = data_dir().join("versions").join(version);
    let libraries_dir = data_dir().join("libraries");
    let assets_dir = data_dir().join("assets");
    fs::create_dir_all(&version_dir).ok();
    fs::create_dir_all(&libraries_dir).ok();
    fs::create_dir_all(&assets_dir).ok();

    let http = reqwest::Client::new();

    // Version manifest
    let manifest: Value = http.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let version_url = manifest["versions"].as_array()
        .and_then(|vs| vs.iter().find(|v| v["id"].as_str() == Some(version)))
        .and_then(|v| v["url"].as_str())
        .ok_or(format!("Version {} not found", version))?;

    let vj_path = version_dir.join(format!("{}.json", version));
    let vdata: Value = if vj_path.exists() {
        serde_json::from_str(&fs::read_to_string(&vj_path).unwrap()).unwrap()
    } else {
        let d: Value = http.get(version_url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        fs::write(&vj_path, serde_json::to_string_pretty(&d).unwrap()).ok();
        d
    };

    // Client JAR
    let jar_path = version_dir.join(format!("{}.jar", version));
    if !jar_path.exists() {
        let jar_url = vdata["downloads"]["client"]["url"].as_str().ok_or("No client jar")?;
        let _ = app.emit("download_progress", DownloadProgress { id: format!("mc|{}", version), name: format!("Minecraft {}", version), downloaded: 0, total: 1 });
        let bytes = http.get(jar_url).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
        fs::write(&jar_path, &bytes).ok();
        let _ = app.emit("download_progress", DownloadProgress { id: format!("mc|{}", version), name: format!("Minecraft {}", version), downloaded: 1, total: 1 });
    }

    // Download assets index file
    let assets_index_name = vdata["assetIndex"]["id"].as_str().unwrap_or("1.8.9");
    let assets_index_path = assets_dir.join("indexes").join(format!("{}.json", assets_index_name));
    fs::create_dir_all(assets_dir.join("indexes")).ok();
    
    if !assets_index_path.exists() {
        if let Some(assets_index_url) = vdata["assetIndex"]["url"].as_str() {
            println!("Downloading assets index: {}", assets_index_name);
            let assets_bytes = http.get(assets_index_url).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
            fs::write(&assets_index_path, &assets_bytes).ok();
            println!("Downloaded assets index: {}", assets_index_name);
        }
    }

    // Libraries
    let mut classpath = vec![jar_path.to_string_lossy().to_string()];
    
    // Add mod loader JARs based on instance type
    match meta.instance_type.as_str() {
        "Fabric" => {
            let fabric_jar = libraries_dir.join("fabric-loader-0.16.10.jar");
            if !fabric_jar.exists() {
                let fabric_url = "https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.10/fabric-loader-0.16.10.jar";
                let _ = app.emit("download_progress", DownloadProgress { id: "fabric-loader".to_string(), name: "Fabric Loader 0.16.10".to_string(), downloaded: 0, total: 1 });
                let fabric_bytes = http.get(fabric_url).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
                fs::write(&fabric_jar, &fabric_bytes).ok();
                let _ = app.emit("download_progress", DownloadProgress { id: "fabric-loader".to_string(), name: "Fabric Loader 0.16.10".to_string(), downloaded: 1, total: 1 });
            }
            classpath.push(fabric_jar.to_string_lossy().to_string());
        }
        "Forge" => {
            // For Forge, we'd need to download the specific Forge version for the Minecraft version
            // For now, we'll use a placeholder approach
            println!("Forge support: Would download Forge for version {}", version);
            // In a full implementation, you'd:
            // 1. Fetch Forge version list from https://files.minecraftforge.net/net/minecraftforge/forge/
            // 2. Download the appropriate Forge installer
            // 3. Extract and add to classpath
        }
        "Quilt" => {
            let quilt_jar = libraries_dir.join("quilt-loader-0.25.1.jar");
            if !quilt_jar.exists() {
                let quilt_url = "https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-loader/0.25.1/quilt-loader-0.25.1.jar";
                let _ = app.emit("download_progress", DownloadProgress { id: "quilt-loader".to_string(), name: "Quilt Loader 0.25.1".to_string(), downloaded: 0, total: 1 });
                let quilt_bytes = http.get(quilt_url).send().await.map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string())?;
                fs::write(&quilt_jar, &quilt_bytes).ok();
                let _ = app.emit("download_progress", DownloadProgress { id: "quilt-loader".to_string(), name: "Quilt Loader 0.25.1".to_string(), downloaded: 1, total: 1 });
            }
            classpath.push(quilt_jar.to_string_lossy().to_string());
        }
        _ => {} // Vanilla - no additional loader needed
    }
    
    // Build classpath and extract native libraries
    let mut native_lib_dirs = Vec::new();
    println!("Starting native library extraction...");
    
    if let Some(libs) = vdata["libraries"].as_array() {
        println!("Found {} libraries in version manifest", libs.len());
        for (_i, lib) in libs.iter().enumerate() {
            if let Some(artifact) = lib["downloads"]["artifact"].as_object() {
                let rel_path = artifact["path"].as_str().unwrap_or("");
                
                // Handle regular JAR libraries (skip native libraries from classpath)
                if !rel_path.contains("natives") {
                    let lib_path = libraries_dir.join(rel_path);
                    if !lib_path.exists() {
                        if let Some(url) = artifact["url"].as_str() {
                            fs::create_dir_all(lib_path.parent().unwrap()).ok();
                            if let Ok(resp) = http.get(url).send().await {
                                if let Ok(b) = resp.bytes().await { fs::write(&lib_path, b).ok(); }
                            }
                        }
                    }
                    if lib_path.exists() { classpath.push(lib_path.to_string_lossy().to_string()); }
                }
            }
        }
    }
    
    // Fallback: Extract native libraries from existing native JARs
    println!("Using fallback native library extraction...");
    println!("Detected OS: {}, Arch: {}", 
        if cfg!(target_os = "macos") { "macos" } else if cfg!(target_os = "windows") { "windows" } else { "linux" },
        if cfg!(target_arch = "aarch64") { "aarch64" } else if cfg!(target_arch = "x86_64") { "x86_64" } else { "unknown" });
    
    let native_key = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "natives-macos-arm64"
        } else {
            "natives-macos"
        }
    } else if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            "natives-windows-arm64"
        } else {
            "natives-windows"
        }
    } else if cfg!(target_os = "linux") {
        "natives-linux"
    } else {
        "natives-unknown"
    };
    
    let native_path = libraries_dir.join(format!("natives/{}", native_key));
    fs::create_dir_all(&native_path).ok();
    
    // Directly extract from known native JAR paths - cross-platform support
    let native_jar_paths = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            vec![
                ("lwjgl-3.4.1", "lwjgl-3.4.1-natives-macos-arm64.jar"),
                ("lwjgl-glfw-3.4.1", "lwjgl-glfw-3.4.1-natives-macos-arm64.jar"),
                ("lwjgl-openal-3.4.1", "lwjgl-openal-3.4.1-natives-macos-arm64.jar"),
                ("lwjgl-opengl-3.4.1", "lwjgl-opengl-3.4.1-natives-macos-arm64.jar"),
                ("lwjgl-stb-3.4.1", "lwjgl-stb-3.4.1-natives-macos-arm64.jar"),
                ("lwjgl-tinyfd-3.4.1", "lwjgl-tinyfd-3.4.1-natives-macos-arm64.jar"),
                ("lwjgl-jemalloc-3.4.1", "lwjgl-jemalloc-3.4.1-natives-macos-arm64.jar"),
                ("lwjgl-freetype-3.4.1", "lwjgl-freetype-3.4.1-natives-macos-arm64.jar")
            ]
        } else {
            vec![
                ("lwjgl-3.4.1", "lwjgl-3.4.1-natives-macos.jar"),
                ("lwjgl-glfw-3.4.1", "lwjgl-glfw-3.4.1-natives-macos.jar"),
                ("lwjgl-openal-3.4.1", "lwjgl-openal-3.4.1-natives-macos.jar"),
                ("lwjgl-opengl-3.4.1", "lwjgl-opengl-3.4.1-natives-macos.jar"),
                ("lwjgl-stb-3.4.1", "lwjgl-stb-3.4.1-natives-macos.jar"),
                ("lwjgl-tinyfd-3.4.1", "lwjgl-tinyfd-3.4.1-natives-macos.jar"),
                ("lwjgl-jemalloc-3.4.1", "lwjgl-jemalloc-3.4.1-natives-macos.jar"),
                ("lwjgl-freetype-3.4.1", "lwjgl-freetype-3.4.1-natives-macos.jar")
            ]
        }
    } else if cfg!(target_os = "windows") {
        if cfg!(target_arch = "aarch64") {
            vec![
                ("lwjgl-3.4.1", "lwjgl-3.4.1-natives-windows-arm64.jar"),
                ("lwjgl-glfw-3.4.1", "lwjgl-glfw-3.4.1-natives-windows-arm64.jar"),
                ("lwjgl-openal-3.4.1", "lwjgl-openal-3.4.1-natives-windows-arm64.jar"),
                ("lwjgl-opengl-3.4.1", "lwjgl-opengl-3.4.1-natives-windows-arm64.jar"),
                ("lwjgl-stb-3.4.1", "lwjgl-stb-3.4.1-natives-windows-arm64.jar"),
                ("lwjgl-tinyfd-3.4.1", "lwjgl-tinyfd-3.4.1-natives-windows-arm64.jar"),
                ("lwjgl-jemalloc-3.4.1", "lwjgl-jemalloc-3.4.1-natives-windows-arm64.jar"),
                ("lwjgl-freetype-3.4.1", "lwjgl-freetype-3.4.1-natives-windows-arm64.jar")
            ]
        } else {
            vec![
                ("lwjgl-3.4.1", "lwjgl-3.4.1-natives-windows.jar"),
                ("lwjgl-glfw-3.4.1", "lwjgl-glfw-3.4.1-natives-windows.jar"),
                ("lwjgl-openal-3.4.1", "lwjgl-openal-3.4.1-natives-windows.jar"),
                ("lwjgl-opengl-3.4.1", "lwjgl-opengl-3.4.1-natives-windows.jar"),
                ("lwjgl-stb-3.4.1", "lwjgl-stb-3.4.1-natives-windows.jar"),
                ("lwjgl-tinyfd-3.4.1", "lwjgl-tinyfd-3.4.1-natives-windows.jar"),
                ("lwjgl-jemalloc-3.4.1", "lwjgl-jemalloc-3.4.1-natives-windows.jar"),
                ("lwjgl-freetype-3.4.1", "lwjgl-freetype-3.4.1-natives-windows.jar")
            ]
        }
    } else if cfg!(target_os = "linux") {
        vec![
            ("lwjgl-3.4.1", "lwjgl-3.4.1-natives-linux.jar"),
            ("lwjgl-glfw-3.4.1", "lwjgl-glfw-3.4.1-natives-linux.jar"),
            ("lwjgl-openal-3.4.1", "lwjgl-openal-3.4.1-natives-linux.jar"),
            ("lwjgl-opengl-3.4.1", "lwjgl-opengl-3.4.1-natives-linux.jar"),
            ("lwjgl-stb-3.4.1", "lwjgl-stb-3.4.1-natives-linux.jar"),
            ("lwjgl-tinyfd-3.4.1", "lwjgl-tinyfd-3.4.1-natives-linux.jar"),
            ("lwjgl-jemalloc-3.4.1", "lwjgl-jemalloc-3.4.1-natives-linux.jar"),
            ("lwjgl-freetype-3.4.1", "lwjgl-freetype-3.4.1-natives-linux.jar")
        ]
    } else {
        vec![] // Unsupported platform
    };
    
    println!("Starting native library extraction for platform: {} {}", 
        if cfg!(target_os = "macos") { "macos" } else if cfg!(target_os = "windows") { "windows" } else { "linux" },
        if cfg!(target_arch = "aarch64") { "arm64" } else if cfg!(target_arch = "x86_64") { "x86_64" } else { "unknown" });

    // Try to extract from classpath JARs first
    for jar_path in &classpath {
        if jar_path.contains("lwjgl") && jar_path.contains("natives") {
            println!("Found native JAR in classpath: {}", jar_path);
            
            match fs::File::open(jar_path) {
                Ok(file) => {
                    match zip::ZipArchive::new(file) {
                        Ok(mut archive) => {
                            println!("Extracting natives from: {}", jar_path);
                            let mut extracted_count = 0;
                            
                            for i in 0..archive.len() {
                                if let Ok(mut zip_file) = archive.by_index(i) {
                                    let file_path_cow = zip_file.mangled_name();
                                    let file_path = file_path_cow.to_string_lossy();
                                    
                                    // Extract native libraries (.dylib, .dll, .so)
                                    if file_path.ends_with(".dylib") || file_path.ends_with(".dll") || file_path.ends_with(".so") {
                                        let filename = file_path.split('/').last().unwrap_or(&file_path);
                                        let out_path = native_path.join(filename);
                                        
                                        match fs::File::create(&out_path) {
                                            Ok(mut out_file) => {
                                                match std::io::copy(&mut zip_file, &mut out_file) {
                                                    Ok(_) => {
                                                        extracted_count += 1;
                                                        println!("Extracted native: {}", filename);
                                                    }
                                                    Err(e) => {
                                                        println!("Failed to extract {}: {}", filename, e);
                                                    }
                                                }
                                            }
                                            Err(e) => {
                                                println!("Failed to create output file {}: {}", filename, e);
                                            }
                                        }
                                    }
                                }
                            }
                            
                            println!("Extracted {} native libraries from {}", extracted_count, jar_path);
                        }
                        Err(e) => {
                            println!("Failed to open JAR {}: {}", jar_path, e);
                        }
                    }
                }
                Err(e) => {
                    println!("Failed to open JAR file {}: {}", jar_path, e);
                }
            }
        }
    }

    // Fallback to hardcoded paths if classpath extraction didn't work
    if native_path.read_dir().unwrap_or_else(|_| std::fs::read_dir(".").unwrap()).next().is_none() {
        println!("Classpath extraction failed, trying hardcoded paths...");
        
        for (jar_name, jar_filename) in &native_jar_paths {
            // Construct the full path to the native JAR
            let jar_path = libraries_dir.join(format!("org/lwjgl/{}/3.4.1/{}", jar_name.replace("-3.4.1", ""), jar_filename));
            
            println!("Trying to extract from: {}", jar_path.display());
            
            if jar_path.exists() {
                println!("Found native JAR: {}", jar_filename);
                
                // Extract native libraries from this JAR
                match fs::File::open(&jar_path) {
                    Ok(file) => {
                        match zip::ZipArchive::new(file) {
                            Ok(mut archive) => {
                                println!("Extracting natives from: {}", jar_filename);
                                let mut extracted_count = 0;
                                
                                for i in 0..archive.len() {
                                    if let Ok(mut zip_file) = archive.by_index(i) {
                                        let file_path_cow = zip_file.mangled_name();
                                        let file_path = file_path_cow.to_string_lossy();
                                        
                                        // Extract native libraries (.dylib, .dll, .so)
                                        if file_path.ends_with(".dylib") || file_path.ends_with(".dll") || file_path.ends_with(".so") {
                                            let filename = file_path.split('/').last().unwrap_or(&file_path);
                                            let out_path = native_path.join(filename);
                                            
                                            match fs::File::create(&out_path) {
                                                Ok(mut out_file) => {
                                                    match std::io::copy(&mut zip_file, &mut out_file) {
                                                        Ok(_) => {
                                                            extracted_count += 1;
                                                            println!("Extracted native: {}", filename);
                                                        }
                                                        Err(e) => {
                                                            println!("Failed to extract {}: {}", filename, e);
                                                        }
                                                    }
                                                }
                                                Err(e) => {
                                                    println!("Failed to create output file {}: {}", filename, e);
                                                }
                                            }
                                        }
                                    }
                                }
                                
                                println!("Extracted {} native libraries from {}", extracted_count, jar_filename);
                            }
                            Err(e) => {
                                println!("Failed to open JAR {}: {}", jar_filename, e);
                            }
                        }
                    }
                    Err(e) => {
                        println!("Failed to open JAR file {}: {}", jar_path.display(), e);
                    }
                }
            } else {
                println!("Native JAR not found: {}", jar_path.display());
            }
        }
    }
    
    if native_path.exists() {
        native_lib_dirs.push(native_path.to_string_lossy().to_string());
        println!("Native library extraction completed. Path: {}", native_path.display());
    } else {
        println!("No native libraries found!");
    }

    // Determine main class based on instance type
    let main_class = match meta.instance_type.as_str() {
        "Fabric" => "net.fabricmc.loader.impl.launch.knot.Knot",
        "Quilt" => "org.quiltmc.loader.impl.launch.knot.Knot",
        "Forge" => {
            // Forge uses different main classes depending on version
            // For newer Forge versions, it uses the same as vanilla
            vdata["mainClass"].as_str().unwrap_or("net.minecraft.client.main.Main")
        }
        _ => vdata["mainClass"].as_str().unwrap_or("net.minecraft.client.main.Main")
    };
    
    let assets_index = vdata["assetIndex"]["id"].as_str().unwrap_or("1.8.9");
    let sep = if cfg!(windows) { ";" } else { ":" };
    let _cp = classpath.join(sep);
    let ram = format!("-Xmx{}G", allocated_ram_gb.max(1));
    
    println!("Main class: {}", main_class);
    println!("Classpath entries: {}", classpath.len());
    println!("Assets index: {}", assets_index);

    // Check if already running
    {
        let process = RUNNING_PROCESS.lock().unwrap();
        if process.is_some() {
            return Err("A game is already running. Stop it first.".into());
        }
    }

    // Emit launching status
    println!("Emitting Launching status for instance: {}", instance_name);
    let launch_status = LaunchStatus { 
        status: "Launching".to_string(), 
        instance_name: instance_name.clone() 
    };
    println!("Launch status payload: {:?}", launch_status);
    
    if let Err(e) = app.emit("tauri://launch_status", launch_status) {
        eprintln!("Failed to emit launch_status: {}", e);
    } else {
        println!("Successfully emitted launch_status event");
    }

    // Log files for stdout/stderr
    let log_dir = instance_dir.join("logs");
    fs::create_dir_all(&log_dir).ok();
    let _stdout_file = std::fs::File::create(log_dir.join("latest.stdout.log")).map_err(|e| e.to_string())?;
    let _stderr_file = std::fs::File::create(log_dir.join("latest.stderr.log")).map_err(|e| e.to_string())?;

    // Check if Java is available and get version
    let java_check = std::process::Command::new("java")
        .arg("-version")
        .output();
    
    match java_check {
        Ok(output) => {
            let version_str = String::from_utf8_lossy(&output.stdout);
            let error_str = String::from_utf8_lossy(&output.stderr);
            println!("Java version check - stdout: {}", version_str);
            println!("Java version check - stderr: {}", error_str);
            
            // Java version output often goes to stderr, check both
            let full_version = format!("{} {}", version_str, error_str);
            
            // Look for any Java 17+ version (including newer versions)
            if full_version.contains("17") || full_version.contains("18") || full_version.contains("19") || full_version.contains("20") || full_version.contains("21") {
                println!("Java version check passed - found compatible version");
                
                // Build Java arguments
                let mut java_args: Vec<String> = vec![
                    ram.clone(),
                    "-Xms512M".to_string(),
                    "-XstartOnFirstThread".to_string(),
                    "--enable-native-access=ALL-UNNAMED".to_string()
                ];
                
                // Add native library path if we have native libraries
                if !native_lib_dirs.is_empty() {
                    let lib_path = native_lib_dirs.join(":");
                    let lib_path_arg = format!("-Djava.library.path={}", lib_path);
                    java_args.push(lib_path_arg);
                    println!("Adding native library path: {}", lib_path);
                } else {
                    println!("Warning: No native libraries found! Using Java's built-in library loading...");
                    // For macOS, we can try without explicit native library path
                    // Java should find the libraries in the classpath
                }
                
                // Add classpath and main arguments
                let game_dir_str = instance_dir.to_string_lossy();
                let assets_dir_str = assets_dir.to_string_lossy();
                
                java_args.extend([
                    "-cp".to_string(),
                    _cp.clone(),
                    main_class.to_string(),
                    "--username".to_string(),
                    profile.username.clone(),
                    "--uuid".to_string(),
                    profile.uuid.clone(),
                    "--accessToken".to_string(),
                    profile.access_token.clone(),
                    "--version".to_string(),
                    version.to_string(),
                    "--gameDir".to_string(),
                    game_dir_str.to_string(),
                    "--assetsDir".to_string(),
                    assets_dir_str.to_string(),
                    "--assetIndex".to_string(),
                    assets_index.to_string(),
                    "--userType".to_string(),
                    if developer_mode { "offline" } else { "msa" }.to_string()
                ]);
                
                println!("Launching Java with command:");
                let command_str = java_args.join(" ");
                println!("java {}", command_str);
                
                let child = std::process::Command::new("java")
                    .args(&java_args)
                    .stdout(std::process::Stdio::from(_stdout_file))
                    .stderr(std::process::Stdio::from(_stderr_file))
                    .spawn()
                    .map_err(|e| format!("Failed to launch: {}. Check Java installation and logs.", e))?;

                // Get process ID for global tracking
                let process_id = child.id();

                // Store the process globally
                {
                    let mut process = RUNNING_PROCESS.lock().unwrap();
                    *process = Some(child);
                }

                // Monitor the process and emit running status when actually ready
                let app_clone = app.clone();
                let instance_name_clone = instance_name.clone();
                let process_id_for_monitor = process_id;
                thread::spawn(move || {
                    // Wait a bit for initial startup
                    thread::sleep(Duration::from_secs(3));
                    
                    // Check if process is actually still running
                    let mut is_actually_running = false;
                    if cfg!(unix) {
                        use std::process::Command;
                        if let Ok(output) = Command::new("kill")
                            .arg("-0")
                            .arg(process_id_for_monitor.to_string())
                            .output() {
                            is_actually_running = output.status.success();
                        }
                    } else {
                        // Windows: check if we can still access the process
                        // For now, assume it's running after 3 seconds
                        is_actually_running = true;
                    }
                    
                    if is_actually_running {
                        println!("Emitting Running status for instance: {}", instance_name_clone);
                        let running_status = LaunchStatus { 
                            status: "Running".to_string(), 
                            instance_name: instance_name_clone.clone() 
                        };
                        println!("Running status payload: {:?}", running_status);
                        if let Err(e) = app_clone.emit("tauri://launch_status", running_status) {
                            eprintln!("Failed to emit running status: {}", e);
                        } else {
                            println!("Successfully emitted running status event");
                        }
                    } else {
                        // Process died during startup
                        println!("Process died during startup, emitting Error status");
                        let error_status = LaunchStatus { 
                            status: "Error".to_string(), 
                            instance_name: instance_name_clone.clone() 
                        };
                        let _ = app_clone.emit("tauri://launch_status", error_status);
                        
                        // Clear the global process
                        let mut process = RUNNING_PROCESS.lock().unwrap();
                        *process = None;
                        return;
                    }
                    
                    // Continue monitoring for process completion
                    loop {
                        {
                            let process = RUNNING_PROCESS.lock().unwrap();
                            if process.is_none() {
                                // Process was manually stopped
                                break;
                            }
                        }
                        
                        // Check if process is still running
                        let mut is_still_running = false;
                        if cfg!(unix) {
                            use std::process::Command;
                            if let Ok(output) = Command::new("kill")
                                .arg("-0")
                                .arg(process_id_for_monitor.to_string())
                                .output() {
                                is_still_running = output.status.success();
                            }
                        } else {
                            // Windows: simple sleep check for now
                            thread::sleep(Duration::from_secs(1));
                            continue;
                        }
                        
                        if !is_still_running {
                            break;
                        }
                        
                        thread::sleep(Duration::from_millis(500));
                    }

                    // Clear the global process and emit stopped status
                    {
                        let mut process = RUNNING_PROCESS.lock().unwrap();
                        *process = None;
                    }
                    
                    let _ = app_clone.emit("tauri://launch_status", LaunchStatus { 
                        status: "Stopped".to_string(), 
                        instance_name: instance_name_clone 
                    });
                });

                // Update last_played
                let mp = instance_dir.join("instance.json");
                if let Ok(s) = fs::read_to_string(&mp) {
                    if let Ok(mut m) = serde_json::from_str::<InstanceMeta>(&s) {
                        m.last_played = "Just now".into();
                        fs::write(&mp, serde_json::to_string_pretty(&m).unwrap()).ok();
                    }
                }
                return Ok(());
            } else {
                return Err(format!("Java 17 or higher is required to run Minecraft. Found: {}. Please install Java 17+.", full_version.trim()));
            }
        }
        Err(e) => {
            return Err(format!("Java not found: {}. Please install Java 17+.", e));
        }
    }
}

// ─── System ──────────────────────────────────────────────────────────────────

#[command]
fn get_system_memory() -> u64 {
    let mut sys = System::new_all();
    sys.refresh_memory();
    sys.total_memory() / 1024 / 1024 / 1024
}

#[command]
fn start_minecraft_instance(instance_name: String) -> Result<String, String> {
    let c = instance_name.clone();
    thread::spawn(move || { thread::sleep(Duration::from_secs(10)); println!("Done: {}", c); });
    Ok(format!("Launched {}", instance_name))
}

// ─── Entry ───────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            start_minecraft_instance,
            start_microsoft_oauth,
            get_saved_profile,
            delete_saved_profile,
            get_system_memory,
            list_instances,
            create_instance,
            delete_instance,
            toggle_favourite,
            download_file,
            launch_instance,
            open_instance_folder,
            list_instance_contents,
            set_pinned_instance,
            set_discord_rpc,
            update_discord_rpc,
            upload_skin,
            purge_cache,
            list_screenshots,
            get_screenshot_base64,
            stop_game,
            is_game_running,
            delete_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
