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
use sha1::Digest as Sha1Digest;
use serde_json::json;

// ─── Global State ────────────────────────────────────────────────────────────
lazy_static! {
    static ref DISCORD_CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
    static ref RUNNING_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);
}

#[command]
async fn fetch_servers() -> Result<Value, String> {
    let url = "https://script.google.com/macros/s/AKfycby6dOIwEwKnwRYx_IwRe7s3jiMRzMDV84-Ot_0b45qBHG6KDvUzROhreQDvc9VZMizJ/exec?action=servers";
    println!("Fetching servers from: {}", url);
    
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "PacketLauncher/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Failed to reach servers backend: {}", e))?;

    println!("Servers response status: {}", resp.status());
    
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        println!("Servers backend error: HTTP {} - {}", status, body);
        return Err(format!("Servers backend failed: HTTP {}: {}", status, body));
    }

    let text = resp.text().await.map_err(|e| format!("Failed to read servers backend response: {}", e))?;
    println!("Servers response length: {} bytes", text.len());
    
    if text.trim().is_empty() {
        return Err("Servers backend returned an empty response".to_string());
    }
    
    // Try to parse and return detailed error if it fails
    match serde_json::from_str::<Value>(&text) {
        Ok(val) => {
            println!("Successfully parsed servers JSON");
            Ok(val)
        }
        Err(e) => {
            println!("Failed to parse servers JSON: {}. First 200 chars: {}", e, &text[..text.len().min(200)]);
            Err(format!("Failed to parse servers JSON: {}", e))
        }
    }
}

// ─── Helper Functions ───────────────────────────────────────────────────────────

async fn download_fabric_loader_libraries(http: &reqwest::Client, libraries_dir: &std::path::Path, instance_dir: &std::path::Path, mc_version: &str, classpath: &mut Vec<String>) -> Result<(), String> {
    println!("Downloading Fabric Loader dependency JSON for Minecraft version {}...", mc_version);
    
    // Use the correct Fabric API: https://meta.fabricmc.net/v2/versions/loader/{game_version}/{loader_version}/profile/json
    let loader_version = "0.19.2";
    let loader_json_url = format!("https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json", mc_version, loader_version);
    
    println!("Trying Fabric API URL: {}", loader_json_url);
    
    // Check for local cache first - save to instance's version folder
    let version_dir = instance_dir.join("versions").join(mc_version);
    fs::create_dir_all(&version_dir).map_err(|e| format!("Failed to create version directory: {}", e))?;
    let cache_file = version_dir.join(format!("fabric-loader-{}.json", mc_version));
    // Download from API
    let response = http.get(&loader_json_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Fabric Loader JSON from {}: {}", loader_json_url, e))?;
    
    if !response.status().is_success() {
        return Err(format!("Fabric Loader JSON request failed with status: {}. URL tried: {}", response.status(), loader_json_url));
    }
    
    let loader_json: Value = response.json().await
        .map_err(|e| format!("Failed to parse Fabric Loader JSON: {}", e))?;
    
    println!("Successfully parsed Fabric Loader JSON");
    
    // Cache the JSON locally
    let json_content = serde_json::to_string_pretty(&loader_json)
        .map_err(|e| format!("Failed to serialize JSON for caching: {}", e))?;
    fs::write(&cache_file, json_content)
        .map_err(|e| format!("Failed to cache JSON: {}", e))?;
    println!("Cached Fabric Loader JSON to: {}", cache_file.display());
    
    // Process libraries
    process_fabric_libraries(http, &loader_json, libraries_dir, classpath).await?;
    
    // Explicitly add intermediary because meta.fabricmc.net omits it for some newer versions
    let intermediary_jar_name = format!("intermediary-{}.jar", mc_version);
    let intermediary_path = libraries_dir.join("net").join("fabricmc").join("intermediary").join(mc_version).join(&intermediary_jar_name);
    
    if !intermediary_path.exists() || fs::metadata(&intermediary_path).map(|m| m.len()).unwrap_or(0) < 1000 {
        let maven_url = format!("https://maven.fabricmc.net/net/fabricmc/intermediary/{}/{}", mc_version, intermediary_jar_name);
        println!("Force-downloading missing intermediary from {}", maven_url);
        if let Ok(resp) = http.get(&maven_url).send().await {
            if resp.status().is_success() {
                if let Ok(bytes) = resp.bytes().await {
                    let _ = fs::create_dir_all(intermediary_path.parent().unwrap());
                    let _ = fs::write(&intermediary_path, &bytes);
                }
            }
        }
    }
    
    let path_str = intermediary_path.to_string_lossy().to_string();
    if !classpath.contains(&path_str) {
        classpath.push(path_str);
    }
    
    Ok(())
}


    



async fn process_fabric_libraries(http: &reqwest::Client, loader_json: &Value, libraries_dir: &std::path::Path, classpath: &mut Vec<String>) -> Result<(), String> {
    println!("Processing Fabric Loader libraries...");
    
    // Download libraries from Fabric Loader JSON
    if let Some(libraries) = loader_json["libraries"].as_array() {
        println!("Found {} libraries in Fabric Loader JSON", libraries.len());
        
        for lib in libraries.iter() {
            if let Some(lib_name) = lib["name"].as_str() {
                println!("Processing Fabric library: {}", lib_name);
                
                // Parse Maven coordinates: group:artifact:version
                let parts: Vec<&str> = lib_name.split(':').collect();
                if parts.len() >= 3 {
                    let group = parts[0];
                    let artifact = parts[1];
                    let version = parts[2];
                    
                    // Download the JAR
                    let jar_name = format!("{}-{}.jar", artifact, version);
                    let jar_path = libraries_dir.join(group.replace('.', "/")).join(artifact).join(version).join(&jar_name);
                    
                    if !jar_path.exists() || fs::metadata(&jar_path).map(|m| m.len()).unwrap_or(0) < 1000 {
                        let base_url = lib["url"].as_str().unwrap_or("https://maven.fabricmc.net/");
                        let maven_url = format!("{}{}/{}/{}/{}", 
                            base_url, group.replace('.', "/"), artifact, version, jar_name);
                        
                        println!("Downloading {} from {}", jar_name, maven_url);
                        let response = http.get(&maven_url).send().await
                            .map_err(|e| format!("Failed to download {}: {}", jar_name, e))?;
                        
                        if response.status().is_success() {
                            let bytes = response.bytes().await.map_err(|e| e.to_string())?;
                            fs::create_dir_all(jar_path.parent().unwrap()).map_err(|e| e.to_string())?;
                            fs::write(&jar_path, &bytes).map_err(|e| e.to_string())?;
                            println!("Successfully downloaded {}", jar_name);
                        } else {
                            // Try Maven Central fallback
                            let fallback_url = format!("https://repo1.maven.org/maven2/{}/{}/{}/{}", 
                                group.replace('.', "/"), artifact, version, jar_name);
                            println!("Falling back to Maven Central: {}", fallback_url);
                            let fallback_resp = http.get(&fallback_url).send().await
                                .map_err(|e| format!("Fallback failed {}: {}", jar_name, e))?;
                            if fallback_resp.status().is_success() {
                                let bytes = fallback_resp.bytes().await.map_err(|e| e.to_string())?;
                                fs::create_dir_all(jar_path.parent().unwrap()).map_err(|e| e.to_string())?;
                                fs::write(&jar_path, &bytes).map_err(|e| e.to_string())?;
                                println!("Successfully downloaded {} from fallback", jar_name);
                            } else {
                                return Err(format!("Failed to download {} from both sources", jar_name));
                            }
                        }
                    }
                    
                    classpath.push(jar_path.to_string_lossy().to_string());
                }
            }
        }
    }
    
    Ok(())
}

fn add_instance_jars_to_classpath(instance_dir: &std::path::Path, classpath: &mut Vec<String>) {
    println!("Scanning instance directory for JAR files: {}", instance_dir.display());
    let mut jar_count = 0;
    
    fn scan_jars(dir: &std::path::Path, classpath: &mut Vec<String>, jar_count: &mut usize) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    // Skip mods folder from classpath (mods are loaded by the mod loader)
                    if path.file_name() == Some(std::ffi::OsStr::new("mods")) {
                        continue;
                    }
                    scan_jars(&path, classpath, jar_count);
                } else if path.extension() == Some(std::ffi::OsStr::new("jar")) {
                    classpath.push(path.to_string_lossy().to_string());
                    *jar_count += 1;
                }
            }
        }
    }
    
    scan_jars(instance_dir, classpath, &mut jar_count);
    println!("Added {} JAR files from instance directory to classpath", jar_count);
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
    data_dir().join("instances")
}

#[command]
fn save_developer_username(username: String) -> Result<(), String> {
    let config_path = data_dir().join("settings.json");
    let mut settings = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        serde_json::from_str::<serde_json::Value>(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::Value::Object(serde_json::Map::new())
    };
    
    settings["developer_username"] = serde_json::Value::String(username);
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
fn get_developer_username() -> Option<String> {
    let config_path = data_dir().join("settings.json");
    if let Ok(settings_content) = std::fs::read_to_string(config_path) {
        if let Ok(settings) = serde_json::from_str::<serde_json::Value>(&settings_content) {
            if let Some(username) = settings["developer_username"].as_str() {
                return Some(username.to_string());
            }
        }
    }
    None
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
fn stop_game(app: AppHandle) -> Result<(), String> {
    let mut process = RUNNING_PROCESS.lock().unwrap();
    if let Some(mut child) = process.take() {
        let pid = child.id();
        
        // On macOS/Unix, child.kill() only sends SIGKILL to the parent.
        // Java spawns subprocesses, so we need kill -9 on the entire process group.
        #[cfg(unix)]
        {
            println!("Stopping game: sending SIGKILL to PID {} and its children", pid);
            // Kill the process group (negative PID = group)
            let _ = std::process::Command::new("kill")
                .args(&["-9", &format!("-{}", pid)])
                .output();
            // Also try direct PID kill as fallback
            let _ = std::process::Command::new("kill")
                .args(&["-9", &pid.to_string()])
                .output();
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill();
        }
        
        // Always emit stopped status regardless of kill result
        let stopped_status = LaunchStatus { 
            status: "Stopped".to_string(), 
            instance_name: "".to_string() 
        };
        if let Err(e) = app.emit("tauri://launch_status", stopped_status) {
            eprintln!("Failed to emit stopped status: {}", e);
        } else {
            println!("Successfully emitted stopped status event");
        }
        Ok(())
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

// ─── MR Pack Installation ─────────────────────────────────────────────────────

// Official Modrinth MRPack format (modrinth.index.json)
// dependencies is a HashMap<String,String> mapping dependency types to version IDs.
// Keys: "minecraft", "fabric-loader", "quilt-loader", "forge", "neoforge", "java", ...
#[derive(Deserialize)]
struct ModrinthIndex {
    #[serde(default)]
    _name: Option<String>,
    #[serde(default)]
    _version_id: Option<String>,
    #[serde(default)]
    _summary: Option<String>,
    files: Vec<ModrinthFile>,
    #[serde(default)]
    dependencies: std::collections::HashMap<String, String>,
}

#[derive(Deserialize)]
struct ModrinthFile {
    path: String,
    hashes: ModrinthHashes,
    downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    _file_size: Option<u64>,
}

#[derive(Deserialize)]
struct ModrinthHashes {
    sha1: Option<String>,
    sha512: Option<String>,
}

#[command]
async fn install_mr_pack(app: AppHandle, url: String, instance_name: String, mc_version: String, download_id: String, _metadata: Option<Value>) -> Result<(), String> {
    let display_name = download_id.split('|').nth(1).unwrap_or(&instance_name).to_string();
    
    // Download MR pack to temporary location
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("{}.mrpack", instance_name));
    let temp_extract_dir = temp_dir.join(format!("{}_extract", instance_name));
    
    let _ = app.emit("download_progress", DownloadProgress { id: download_id.clone(), name: format!("Downloading {}", display_name), downloaded: 0, total: 1 });
    
    // Step 1: Download the MR pack
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    
    // Check if the download was successful
    if !resp.status().is_success() {
        return Err(format!("Failed to download MR pack: HTTP {}", resp.status()));
    }
    
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&temp_file).await.map_err(|e| e.to_string())?;
    
    let mut stream = resp.bytes_stream();
    let mut done = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        done += chunk.len() as u64;
        let _ = app.emit("download_progress", DownloadProgress { id: download_id.clone(), name: format!("Downloading {}", display_name), downloaded: done, total });
    }
    
    // Step 2: Extract MR pack to read modrinth.index.json
    let _ = app.emit("download_progress", DownloadProgress { id: download_id.clone(), name: format!("Extracting {}", display_name), downloaded: 1, total: 1 });
    
    fs::create_dir_all(&temp_extract_dir).map_err(|e| e.to_string())?;
    
    // Validate the downloaded file before attempting to open as zip
    if !temp_file.exists() {
        return Err("Downloaded MR pack file not found".to_string());
    }
    
    // Check file size to ensure it's not empty
    let file_size = fs::metadata(&temp_file).map_err(|e| e.to_string())?.len();
    if file_size == 0 {
        return Err("Downloaded MR pack file is empty".to_string());
    }
    
    // Try to open the zip file with better error handling
    let zip_file = match fs::File::open(&temp_file) {
        Ok(file) => file,
        Err(e) => {
            return Err(format!("Failed to open downloaded MR pack file: {}", e));
        }
    };
    
    let mut archive = match zip::ZipArchive::new(zip_file) {
        Ok(archive) => archive,
        Err(e) => {
            return Err(format!("Invalid MR pack file (corrupted or incomplete download): {}. Please try downloading again.", e));
        }
    };
    
    let mut modrinth_index: Option<ModrinthIndex> = None;
    
    // Extract all files and find modrinth.index.json
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let file_path_cow = file.mangled_name();
        let file_path = file_path_cow.to_string_lossy();
        
        let output_path = temp_extract_dir.join(&*file_path);
        if file.name().ends_with('/') {
            fs::create_dir_all(&output_path).ok();
        } else {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).ok();
            }

            // Parse modrinth.index.json before consuming the zip entry stream.
            // (std::io::copy consumes the stream; reading afterwards yields empty content -> EOF)
            if file_path == "modrinth.index.json" {
                let mut content = String::new();
                file.read_to_string(&mut content).map_err(|e| e.to_string())?;
                modrinth_index = Some(serde_json::from_str(&content).map_err(|e| e.to_string())?);
                fs::write(&output_path, content).map_err(|e| e.to_string())?;
            } else {
                let mut output_file = fs::File::create(&output_path).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut output_file).map_err(|e| e.to_string())?;
            }
        }
    }
    
    let index = modrinth_index.ok_or("modrinth.index.json not found in MR pack")?;
    
    // Step 3: Create instance directory
    let instance_dir = instances_dir().join(&instance_name);
    fs::create_dir_all(&instance_dir).map_err(|e| e.to_string())?;
    
    // Step 4: Handle file overrides
    let overrides_dir = temp_extract_dir.join("overrides");
    if overrides_dir.exists() {
        let _ = app.emit("download_progress", DownloadProgress { id: download_id.clone(), name: format!("Applying overrides"), downloaded: 1, total: 1 });
        copy_dir_all(&overrides_dir, &instance_dir).map_err(|e| e.to_string())?;
    }
    
    // Handle client-specific overrides
    let client_overrides_dir = temp_extract_dir.join("client-overrides");
    if client_overrides_dir.exists() {
        let _ = app.emit("download_progress", DownloadProgress { id: download_id.clone(), name: format!("Applying client overrides"), downloaded: 1, total: 1 });
        copy_dir_all(&client_overrides_dir, &instance_dir).map_err(|e| e.to_string())?;
    }
    
    // Step 5: Download external files
    let http = reqwest::Client::new();
    for (file_index, file_info) in index.files.iter().enumerate() {
        let file_display_name = format!("Downloading file {} of {}", file_index + 1, index.files.len());
        let _ = app.emit("download_progress", DownloadProgress { id: format!("{}|file{}", download_id, file_index), name: file_display_name.clone(), downloaded: 0, total: 1 });

        let url = file_info
            .downloads
            .first()
            .ok_or_else(|| format!("No downloads array entries for {}", file_info.path))?;

        // Download the file
        let resp = http.get(url).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Failed to download {}: HTTP {}", file_info.path, resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

        // Verify hash if available (MRPack uses hashes on the file, not per-download)
        if let Some(expected_sha512) = &file_info.hashes.sha512 {
            let actual = format!("{:x}", sha2::Sha512::digest(&bytes));
            if &actual != expected_sha512 {
                return Err(format!(
                    "Hash verification failed for {} (sha512): expected {}, got {}",
                    file_info.path, expected_sha512, actual
                ));
            }
        } else if let Some(expected_sha1) = &file_info.hashes.sha1 {
            let actual = format!("{:x}", sha1::Sha1::digest(&bytes));
            if &actual != expected_sha1 {
                return Err(format!(
                    "Hash verification failed for {} (sha1): expected {}, got {}",
                    file_info.path, expected_sha1, actual
                ));
            }
        }

        // Save file to correct location
        let target_path = instance_dir.join(&file_info.path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(&target_path, &bytes).map_err(|e| e.to_string())?;

        let _ = app.emit("download_progress", DownloadProgress { id: format!("{}|file{}", download_id, file_index), name: file_display_name, downloaded: 1, total: 1 });
    }
    
    // Step 6: Create instance.json with proper metadata
    // Derive loader from dependency keys in the official MRPack format
    let instance_type = if index.dependencies.contains_key("fabric-loader") {
        "Fabric"
    } else {
        "Vanilla"
    };
    
    // Game version comes from the "minecraft" dependency in the official format
    let final_game_version = index.dependencies.get("minecraft")
        .cloned()
        .unwrap_or_else(|| mc_version.to_string());
    
    let instance_meta = InstanceMeta {
        name: instance_name.clone(),
        instance_type: instance_type.to_string(),
        version: final_game_version,
        last_played: "Never".to_string(),
        favourite: false,
        pinned: false,
    };
    
    let instance_json_path = instance_dir.join("instance.json");
    fs::write(instance_json_path, serde_json::to_string_pretty(&instance_meta).unwrap()).map_err(|e| e.to_string())?;
    
    // Step 7: Clean up
    fs::remove_file(temp_file).ok();
    fs::remove_dir_all(temp_extract_dir).ok();
    
    let _ = app.emit("download_progress", DownloadProgress { id: download_id.clone(), name: format!("{} installed successfully!", display_name), downloaded: 1, total: 1 });
    
    Ok(())
}

// Helper function to copy directory recursively
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        
        if file_type.is_dir() {
            copy_dir_all(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
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
async fn refresh_saved_profile() -> Option<MinecraftProfile> {
    let p_path = data_dir().join("profile.json");
    if !p_path.exists() { return None; }
    
    let mut profile: MinecraftProfile = serde_json::from_str(&fs::read_to_string(&p_path).ok()?).ok()?;
    
    let client = reqwest::Client::new();
    if let Ok(resp) = client.get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&profile.access_token)
        .send().await 
    {
        if resp.status().is_success() {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                if let Some(name) = body["name"].as_str() {
                    profile.username = name.to_string();
                }
                if let Some(skins) = body["skins"].as_array() {
                    if let Some(active_skin) = skins.iter().find(|s| s["state"] == "ACTIVE") {
                        if let Some(url) = active_skin["url"].as_str() {
                            profile.skin_url = url.to_string();
                        }
                    }
                }
                let _ = fs::write(&p_path, serde_json::to_string_pretty(&profile).unwrap());
            }
        }
    }
    
    Some(profile)
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
        // Refresh saved profile using the POST response body
        let new_p: Value = resp.json().await.map_err(|e| e.to_string())?;
        let mut updated = profile.clone();
        
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
async fn launch_instance(
    app: AppHandle, 
    instance_name: String, 
    allocated_ram_gb: u32, 
    developer_mode: bool,
    server_ip: Option<String>,
    quickplay_singleplayer: Option<String>,
) -> Result<(), String> {
    
    let profile: MinecraftProfile = if developer_mode {
        // Use offline/developer credentials for testing
        let dev_username = get_developer_username().unwrap_or("Developer".to_string());
        MinecraftProfile {
            uuid: "01234567-89ab-cdef-0123-456789abcdef".to_string(),
            username: dev_username,
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
    let instance_json_path = instance_dir.join("instance.json");
    
    // Check if instance.json exists and is readable
    if !instance_json_path.exists() {
        return Err(format!("Instance configuration file not found: {}", instance_json_path.display()));
    }
    
    let instance_content = fs::read_to_string(&instance_json_path).map_err(|e| {
        format!("Failed to read instance configuration file: {}", e)
    })?;
    
    // Check if file is empty
    if instance_content.trim().is_empty() {
        return Err("Instance configuration file is empty. Please delete and recreate the instance.".to_string());
    }
    
    let meta: InstanceMeta = serde_json::from_str(&instance_content).map_err(|e| {
        format!("Failed to parse instance configuration: {}. The file may be corrupted.", e)
    })?;
    
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
    let manifest_response = http.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")
        .send().await.map_err(|e| format!("Failed to fetch version manifest: {}", e))?;
    
    if !manifest_response.status().is_success() {
        return Err(format!("Failed to fetch version manifest: HTTP {}", manifest_response.status()));
    }
    
    let manifest_text = manifest_response.text().await.map_err(|e| format!("Failed to read version manifest response: {}", e))?;
    
    // Check if the response is empty
    if manifest_text.trim().is_empty() {
        return Err("Version manifest response is empty".to_string());
    }
    
    let manifest: Value = serde_json::from_str(&manifest_text).map_err(|e| format!("Failed to parse version manifest JSON: {}", e))?;
    
    let version_url = manifest["versions"].as_array()
        .and_then(|vs| vs.iter().find(|v| v["id"].as_str() == Some(version)))
        .and_then(|v| v["url"].as_str())
        .ok_or(format!("Version {} not found in manifest", version))?;

    let vj_path = version_dir.join(format!("{}.json", version));
    let vdata: Value = if vj_path.exists() {
        let version_content = fs::read_to_string(&vj_path).map_err(|e| format!("Failed to read version file {}: {}", vj_path.display(), e))?;
        if version_content.trim().is_empty() {
            return Err(format!("Version file {} is empty", vj_path.display()));
        }
        serde_json::from_str(&version_content).map_err(|e| format!("Failed to parse version JSON from {}: {}", vj_path.display(), e))?
    } else {
        let version_response = http.get(version_url).send().await.map_err(|e| format!("Failed to fetch version data from {}: {}", version_url, e))?;
        
        if !version_response.status().is_success() {
            return Err(format!("Failed to fetch version data: HTTP {}", version_response.status()));
        }
        
        let version_text = version_response.text().await.map_err(|e| format!("Failed to read version data response: {}", e))?;
        
        if version_text.trim().is_empty() {
            return Err("Version data response is empty".to_string());
        }
        
        let d: Value = serde_json::from_str(&version_text).map_err(|e| format!("Failed to parse version data JSON: {}", e))?;
        fs::write(&vj_path, serde_json::to_string_pretty(&d).unwrap()).map_err(|e| format!("Failed to save version file: {}", e))?;
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

    // Download actual asset objects
    if let Ok(assets_index_content) = fs::read_to_string(&assets_index_path) {
        if let Ok(assets_index) = serde_json::from_str::<serde_json::Value>(&assets_index_content) {
            if let Some(objects) = assets_index["objects"].as_object() {
                println!("Downloading {} asset objects...", objects.len());
                let mut downloaded_count = 0;
                
                for (asset_name, asset_info) in objects {
                    if let Some(hash) = asset_info["hash"].as_str() {
                        let hash_prefix = &hash[..2];
                        let asset_path = assets_dir.join("objects").join(hash_prefix).join(hash);
                        fs::create_dir_all(asset_path.parent().unwrap()).ok();
                        
                        if !asset_path.exists() {
                            let asset_url = format!("https://resources.download.minecraft.net/{}/{}", hash_prefix, hash);
                            match http.get(&asset_url).send().await {
                                Ok(response) => {
                                    match response.bytes().await {
                                        Ok(bytes) => {
                                            fs::write(&asset_path, &bytes).ok();
                                            downloaded_count += 1;
                                        }
                                        Err(e) => {
                                            println!("Failed to download asset {}: {}", asset_name, e);
                                        }
                                    }
                                }
                                Err(e) => {
                                    println!("Failed to fetch asset {}: {}", asset_name, e);
                                }
                            }
                        }
                    }
                }
                
                println!("Downloaded {} new asset objects", downloaded_count);
            }
        }
    }

    // Libraries
    let mut classpath = vec![jar_path.to_string_lossy().to_string()];
    
    // Add mod loader JARs and instance libraries based on instance type
    match meta.instance_type.as_str() {
        "Fabric" => {
            println!("Fabric instance detected - downloading Fabric Loader and all dependencies...");
            
            // Clean up old flat-path fabric-loader JAR if it exists (legacy from previous versions)
            let old_fabric_jar = libraries_dir.join("fabric-loader-0.16.10.jar");
            if old_fabric_jar.exists() {
                println!("Removing old flat-path fabric-loader JAR to avoid duplicate classpath entries");
                let _ = fs::remove_file(&old_fabric_jar);
            }
            
            // Download Fabric Loader + ALL dependencies from official Fabric meta API JSON
            // This handles downloading fabric-loader itself and all transitive deps to proper Maven paths
            download_fabric_loader_libraries(&http, &libraries_dir, &instances_dir().join(&instance_name), &version, &mut classpath).await?;
            
            // Add all JAR files from instance directory (mods, libraries from modpack)
            add_instance_jars_to_classpath(&instances_dir().join(&instance_name), &mut classpath);
        }
        _ => {} // Vanilla - no additional loader needed
    }
    
    // Add vanilla Minecraft libraries for all instances
    if let Some(libs) = vdata["libraries"].as_array() {
        for lib in libs.iter() {
            if let Some(artifact) = lib["downloads"]["artifact"].as_object() {
                if let Some(rel_path) = artifact["path"].as_str() {
                    let lib_path = libraries_dir.join(rel_path);
                    if lib_path.exists() && !lib_path.to_string_lossy().contains("natives") {
                        classpath.push(lib_path.to_string_lossy().to_string());
                    }
                }
            }
        }
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
        "Fabric" => "net.fabricmc.loader.impl.launch.knot.KnotClient",
        _ => vdata["mainClass"].as_str().unwrap_or("net.minecraft.client.main.Main")
    };
    
    let assets_index = vdata["assetIndex"]["id"].as_str().unwrap_or("1.8.9");
    let sep = if cfg!(windows) { ";" } else { ":" };
    
    // Deduplicate classpath entries (preserve order, remove duplicates)
    {
        let mut seen = std::collections::HashSet::new();
        classpath.retain(|entry| seen.insert(entry.clone()));
    }
    
    let _cp = classpath.join(sep);
    let ram = format!("-Xmx{}G", allocated_ram_gb.max(1));
    
    println!("Main class: {}", main_class);
    println!("Classpath entries (deduplicated): {}", classpath.len());
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
                
                // Build the arguments array with proper order
                let mut args = vec![
                    "-cp".to_string(),
                    _cp.clone(),
                    main_class.to_string(),
                ];
                
                // Add Minecraft arguments
                args.extend([
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
                
                if let Some(ref ip) = server_ip {
                    if !ip.trim().is_empty() {
                        args.extend([
                            "--server".to_string(),
                            ip.trim().to_string(),
                            "--quickPlayMultiplayer".to_string(),
                            ip.trim().to_string(),
                        ]);
                    }
                }

                if let Some(ref world) = quickplay_singleplayer {
                    if !world.trim().is_empty() {
                        args.extend([
                            "--quickPlaySingleplayer".to_string(),
                            world.trim().to_string(),
                        ]);
                    }
                }

                java_args.extend(args);
                
                println!("=== DEBUG: Complete Java Launch Command ===");
                println!("Working directory: {}", instance_dir.display());
                println!("Main class: {}", main_class);
                println!("Instance type: {}", meta.instance_type);
                println!("Java version: {}", version);
                println!("Native library dirs: {:?}", native_lib_dirs);
                println!("Total classpath entries: {}", classpath.len());
                
                // Print each classpath entry for debugging
                for (i, entry) in classpath.iter().enumerate() {
                    println!("CP[{}]: {}", i, entry);
                }
                
                // Build and print the complete command
                let command_str = java_args.join(" ");
                println!("=== FULL JAVA COMMAND ===");
                println!("java {}", command_str);
                println!("=== END DEBUG ===");
                
                // Try to launch Java with immediate error capture
                let mut child = std::process::Command::new("java")
                    .args(&java_args)
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .map_err(|e| format!("Failed to launch Java: {}", e))?;
                
                // Check if process exits immediately (within 5 seconds for slow hardware)
                thread::sleep(Duration::from_millis(5000));
                match child.try_wait() {
                    Ok(Some(status)) => {
                        println!("Java exited within 5 seconds with status: {:?}", status);
                        // Capture stdout/stderr if available
                        let mut stdout_str = String::new();
                        let mut stderr_str = String::new();
                        use std::io::Read;
                        if let Some(stdout) = child.stdout.take() {
                            let _ = std::io::BufReader::new(stdout).read_to_string(&mut stdout_str);
                            if !stdout_str.trim().is_empty() {
                                println!("Java stdout: {}", stdout_str);
                            }
                        }
                        if let Some(stderr) = child.stderr.take() {
                            let _ = std::io::BufReader::new(stderr).read_to_string(&mut stderr_str);
                            if !stderr_str.trim().is_empty() {
                                println!("Java stderr: {}", stderr_str);
                            }
                        }
                        return Err(format!("Java exited within 5 seconds with status: {:?}.\\nStdout: {}\\nStderr: {}", status, stdout_str.trim(), stderr_str.trim()));
                    }
                    Ok(None) => {
                        println!("Java process is still running after 5 seconds - good sign");
                        
                        // IMPORTANT: Kill the check process before launching the real one to avoid double instances
                        let _ = child.kill();
                        drop(child);
                    }
                    Err(e) => {
                        println!("Error checking Java process: {}", e);
                        return Err(format!("Error checking Java process: {}", e));
                    }
                }
                
                
                // Redirect to log files now that we know it's running
                let _stdout_file = std::fs::File::create(log_dir.join("latest.stdout.log")).map_err(|e| e.to_string())?;
                let _stderr_file = std::fs::File::create(log_dir.join("latest.stderr.log")).map_err(|e| e.to_string())?;

                // Relaunch with proper logging now that we know it should work
                let child = std::process::Command::new("java")
                    .args(&java_args)
                    .stdout(std::process::Stdio::from(_stdout_file))
                    .stderr(std::process::Stdio::from(_stderr_file))
                    .spawn()
                    .map_err(|e| format!("Failed to launch: {}. Check Java installation and logs.", e))?;

                // Store the process globally
                {
                    let mut process = RUNNING_PROCESS.lock().unwrap();
                    *process = Some(child);
                }

                // Monitor the process and emit running status when actually ready
                let app_clone = app.clone();
                let instance_name_clone = instance_name.clone();
                thread::spawn(move || {
                    // Wait much longer for initial startup - Java/Minecraft can take significant time on 2014 Mac Mini
                    thread::sleep(Duration::from_secs(30));

                    // Check if process is actually still running using try_wait on the Child
                    let is_actually_running = {
                        let mut process = RUNNING_PROCESS.lock().unwrap();
                        if let Some(ref mut child) = *process {
                            match child.try_wait() {
                                Ok(None) => {
                                    println!("Process confirmed running after 30 seconds");
                                    true
                                },
                                Ok(Some(status)) => {
                                    println!("Process exited during startup with status: {:?}", status);
                                    false
                                },
                                Err(e) => {
                                    println!("Error checking process status: {}", e);
                                    false
                                }
                            }
                        } else {
                            println!("Process manually stopped before initial check");
                            false // Manually stopped before we got here
                        }
                    };

                    if is_actually_running {
                        println!("Emitting Running status for instance: {}", instance_name_clone);
                        let running_status = LaunchStatus {
                            status: "Running".to_string(),
                            instance_name: instance_name_clone.clone()
                        };
                        if let Err(e) = app_clone.emit("tauri://launch_status", running_status) {
                            eprintln!("Failed to emit running status: {}", e);
                        } else {
                            println!("Successfully emitted running status event");
                        }

                        // Continue monitoring for process termination
                        loop {
                            thread::sleep(Duration::from_secs(2));

                            // Use try_wait to properly detect process exit (normal exit, crash, or kill)
                            let process_exited = {
                                let mut process = RUNNING_PROCESS.lock().unwrap();
                                if let Some(ref mut child) = *process {
                                    match child.try_wait() {
                                        Ok(None) => false,  // Still running
                                        Ok(Some(status)) => {
                                            println!("Process exited with status: {:?}", status);
                                            true
                                        }
                                        Err(e) => {
                                            println!("Error checking process status: {}", e);
                                            true // Assume exited on error
                                        }
                                    }
                                } else {
                                    true // Process was manually stopped
                                }
                            };

                            if process_exited {
                                println!("Process ended, emitting Stopped status");
                                let stopped_status = LaunchStatus {
                                    status: "Stopped".to_string(),
                                    instance_name: instance_name_clone.clone()
                                };
                                if let Err(e) = app_clone.emit("tauri://launch_status", stopped_status) {
                                    eprintln!("Failed to emit stopped status: {}", e);
                                } else {
                                    println!("Successfully emitted stopped status event");
                                }
                                // Clear global process state and wait on child to reap zombie
                                {
                                    let mut process = RUNNING_PROCESS.lock().unwrap();
                                    if let Some(mut child) = process.take() {
                                        let _ = child.wait(); // Reap zombie process
                                    }
                                }
                                break;
                            }
                        }
                    } else {
                        // Process died during startup
                        println!("Process died during startup");
                        let failed_status = LaunchStatus {
                            status: "Stopped".to_string(),
                            instance_name: instance_name_clone.clone()
                        };
                        if let Err(e) = app_clone.emit("tauri://launch_status", failed_status) {
                            eprintln!("Failed to emit failed status: {}", e);
                        }
                        // Clear global process state
                        {
                            let mut process = RUNNING_PROCESS.lock().unwrap();
                            if let Some(mut child) = process.take() {
                                let _ = child.wait(); // Reap zombie
                            }
                        }
                    }
                });

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

#[command]
async fn modrinth_search(query: String, project_type: String, limit: u32) -> Result<Value, String> {
    let facets = if project_type == "mod" || project_type == "modpack" {
        json!([
            [format!("project_type:{}", project_type)],
            ["categories:fabric"]
        ]).to_string()
    } else {
        json!([
            [format!("project_type:{}", project_type)]
        ]).to_string()
    };
    let url = format!(
        "https://api.modrinth.com/v2/search?query={}&facets={}&limit={}",
        urlencoding::encode(&query),
        urlencoding::encode(&facets),
        limit.max(1).min(100)
    );

    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "PacketLauncher/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Failed to reach Modrinth: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Modrinth search failed: HTTP {}: {}", status, body));
    }

    let text = resp.text().await.map_err(|e| format!("Failed to read Modrinth response: {}", e))?;
    if text.trim().is_empty() {
        return Err("Modrinth returned an empty response".to_string());
    }
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse Modrinth JSON: {}", e))
}

#[command]
async fn modrinth_project_versions(project_id: String) -> Result<Value, String> {
    let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);
    let client = reqwest::Client::new();
    let resp = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "PacketLauncher/0.1.0")
        .send()
        .await
        .map_err(|e| format!("Failed to reach Modrinth: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Modrinth versions fetch failed: HTTP {}: {}", status, body));
    }

    let text = resp.text().await.map_err(|e| format!("Failed to read Modrinth response: {}", e))?;
    if text.trim().is_empty() {
        return Err("Modrinth returned an empty response".to_string());
    }
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse Modrinth JSON: {}", e))
}

#[command]
fn list_singleplayer_worlds(instance_name: String) -> Result<Vec<String>, String> {
    let saves_dir = instances_dir().join(&instance_name).join("saves");
    if !saves_dir.exists() {
        return Ok(vec![]);
    }
    let mut worlds = Vec::new();
    if let Ok(entries) = std::fs::read_dir(saves_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    worlds.push(name.to_string());
                }
            }
        }
    }
    worlds.sort();
    Ok(worlds)
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
            modrinth_search,
            modrinth_project_versions,
            fetch_servers,
            start_microsoft_oauth,
            get_saved_profile,
            refresh_saved_profile,
            delete_saved_profile,
            get_system_memory,
            list_instances,
            create_instance,
            delete_instance,
            toggle_favourite,
            download_file,
            install_mr_pack,
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
            delete_file,
            save_developer_username,
            get_developer_username,
            list_singleplayer_worlds
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
