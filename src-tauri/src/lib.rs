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

// ─── Global State ────────────────────────────────────────────────────────────
lazy_static! {
    static ref DISCORD_CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
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
async fn launch_instance(app: AppHandle, instance_name: String, allocated_ram_gb: u32) -> Result<(), String> {
    let profile_path = data_dir().join("profile.json");
    if !profile_path.exists() { return Err("Not logged in. Sign in with Microsoft first.".into()); }
    let profile: MinecraftProfile = serde_json::from_str(&fs::read_to_string(&profile_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;

    let instance_dir = instances_dir().join(&instance_name);
    let meta: InstanceMeta = serde_json::from_str(&fs::read_to_string(instance_dir.join("instance.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let version = &meta.version;

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

    // Libraries
    let mut classpath = vec![jar_path.to_string_lossy().to_string()];
    if let Some(libs) = vdata["libraries"].as_array() {
        for lib in libs {
            if let Some(artifact) = lib["downloads"]["artifact"].as_object() {
                let rel_path = artifact["path"].as_str().unwrap_or("");
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

    let main_class = vdata["mainClass"].as_str().unwrap_or("net.minecraft.client.main.Main");
    let assets_index = vdata["assetIndex"]["id"].as_str().unwrap_or("18");
    let sep = if cfg!(windows) { ";" } else { ":" };
    let cp = classpath.join(sep);
    let ram = format!("-Xmx{}G", allocated_ram_gb.max(1));

    std::process::Command::new("java")
        .args([&ram, "-Xms512M", "-cp", &cp, main_class,
               "--username", &profile.username,
               "--uuid", &profile.uuid,
               "--accessToken", &profile.access_token,
               "--version", version,
               "--gameDir", &instance_dir.to_string_lossy(),
               "--assetsDir", &assets_dir.to_string_lossy(),
               "--assetIndex", assets_index,
               "--userType", "msa"])
        .spawn()
        .map_err(|e| format!("Failed to launch: {}. Is Java 17+ installed?", e))?;

    // Update last_played
    let mp = instance_dir.join("instance.json");
    if let Ok(s) = fs::read_to_string(&mp) {
        if let Ok(mut m) = serde_json::from_str::<InstanceMeta>(&s) {
            m.last_played = "Just now".into();
            fs::write(&mp, serde_json::to_string_pretty(&m).unwrap()).ok();
        }
    }
    Ok(())
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
            purge_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
