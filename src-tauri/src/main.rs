#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};
use url::Url;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn get_port() -> u16 {
    env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(5175)
}

fn check_backend_alive(port: u16, timeout_ms: u64) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let timeout = Duration::from_millis(timeout_ms);
    let mut stream = match TcpStream::connect_timeout(&addr, timeout) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let req = format!(
        "GET /api/health/ready HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    match stream.read(&mut buf) {
        Ok(n) if n > 0 => {
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/1.1 200") || head.starts_with("HTTP/1.0 200")
        }
        _ => false,
    }
}

#[cfg(windows)]
fn reclaim_port(port: u16) {
    let current_pid = std::process::id();
    let out = Command::new("cmd")
        .args([
            "/C",
            &format!("netstat -ano -p tcp | findstr :{port} | findstr LISTENING"),
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    let Ok(output) = out else { return };
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(pid_str) = line.split_whitespace().last() {
            if let Ok(pid) = pid_str.parse::<u32>() {
                if pid != 0 && pid != current_pid {
                    let _ = Command::new("taskkill")
                        .args(["/F", "/T", "/PID", &pid.to_string()])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();
                }
            }
        }
    }
}

#[cfg(not(windows))]
fn reclaim_port(_port: u16) {}

fn clean_all_session_locks(exe_dir: &Path) {
    let mut dirs: Vec<PathBuf> = vec![exe_dir.to_path_buf()];
    if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
        let user_app_dir = PathBuf::from(local_app_data).join("AI Pharmacy OS");
        if user_app_dir != exe_dir {
            dirs.push(user_app_dir);
        }
    }

    let rel_locks = [
        ".wwebjs_auth/session/devtoolsactiveport",
        ".wwebjs_auth/session/Default/devtoolsactiveport",
        ".wwebjs_auth/session/lockfile",
        ".wwebjs_auth/session/SingletonLock",
        "data/pharmarack_profile/SingletonLock",
        "data/pharmarack_profile/lockfile",
        "data/pharmarack_profile/devtoolsactiveport",
    ];

    for dir in dirs {
        for rel in rel_locks {
            let p = dir.join(rel);
            if p.exists() {
                let _ = fs::remove_file(&p);
            }
        }
    }
}

fn spawn_backend(exe_dir: &Path, port: u16) -> Option<Child> {
    let packaged_backend = exe_dir.join("PharmacyBackend.exe");
    let direct_server_cjs = exe_dir.join("dist-pkg").join("server.cjs");

    let log_dir = exe_dir.join("data");
    let _ = fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("backend.log");

    let stdout_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();
    let stderr_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();

    let mut cmd = if packaged_backend.exists() {
        Command::new(&packaged_backend)
    } else if direct_server_cjs.exists() {
        let mut c = Command::new("node");
        c.arg(&direct_server_cjs);
        c
    } else {
        // Dev fallback when running from target/release inside repo
        let mut c = Command::new("cmd");
        c.args(["/C", "npx", "tsx", "src/bootstrap.ts"]);
        c
    };

    let existing_node_opts = env::var("NODE_OPTIONS").unwrap_or_default();
    let node_opts = format!("{existing_node_opts} --max-old-space-size=512")
        .trim()
        .to_string();

    cmd.current_dir(exe_dir)
        .env("ELECTRON_MODE", "true")
        .env("PORT", port.to_string())
        .env("NODE_OPTIONS", node_opts)
        .stdin(Stdio::null());

    if let Some(f) = stdout_file {
        cmd.stdout(Stdio::from(f));
    } else {
        cmd.stdout(Stdio::null());
    }
    if let Some(f) = stderr_file {
        cmd.stderr(Stdio::from(f));
    } else {
        cmd.stderr(Stdio::null());
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn().ok()
}

fn find_latest_preupdate_backup(exe_dir: &Path) -> Option<PathBuf> {
    let backup_root = exe_dir.join("backup");
    let entries = fs::read_dir(&backup_root).ok()?;
    let mut candidates: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|x| x.path()))
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.starts_with("preupdate-"))
                    .unwrap_or(false)
                && p.join("PharmacyOS.exe").exists()
        })
        .collect();
    // Lexicographical sort on preupdate-YYYYMMDDHHMMSS puts newest last
    candidates.sort();
    candidates.pop()
}

fn trigger_post_update_rollback(exe_dir: &Path, reason: &str) -> bool {
    let staging_dir = exe_dir.join("updates").join("staging");
    let success_flag = staging_dir.join("success.json");
    if !success_flag.exists() {
        return false;
    }

    let Some(backup_dir) = find_latest_preupdate_backup(exe_dir) else {
        return false;
    };

    let _ = fs::create_dir_all(&staging_dir);
    let _ = fs::remove_file(&success_flag);
    let safe_reason = reason.replace('"', "'");
    let fail_json = format!(
        "{{\"version\":\"unknown\",\"error\":\"{safe_reason}\",\"rollback\":\"attempted\"}}"
    );
    let _ = fs::write(staging_dir.join("failure.json"), &fail_json);
    let _ = fs::write(staging_dir.join("rollback.json"), &fail_json);

    let current_pid = std::process::id();
    let script_path = staging_dir.join("boot-rollback.ps1");
    let install_str = exe_dir.to_string_lossy().replace('\'', "''");
    let backup_str = backup_dir.to_string_lossy().replace('\'', "''");

    let ps_script = format!(
        r#"$ErrorActionPreference = 'SilentlyContinue'
$InstallDir = '{install_str}'
$BackupDir  = '{backup_str}'
$WaitPid    = {current_pid}

for ($i = 0; $i -lt 40; $i++) {{
    if (-not (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)) {{ break }}
    Start-Sleep -Milliseconds 250
}}
& taskkill.exe /F /T /IM PharmacyOS.exe 2>&1 | Out-Null
& taskkill.exe /F /T /IM PharmacyBackend.exe 2>&1 | Out-Null
Start-Sleep -Milliseconds 500

foreach ($f in @('PharmacyOS.exe', 'WebView2Loader.dll', 'PharmacyBackend.exe', 'sea-entry.cjs', 'Updater.bat', 'UpdateGUI.ps1')) {{
    $src = Join-Path $BackupDir $f
    $dst = Join-Path $InstallDir $f
    if (Test-Path -LiteralPath $src) {{
        for ($a = 1; $a -le 6; $a++) {{
            try {{ Copy-Item -LiteralPath $src -Destination $dst -Force -ErrorAction Stop; break }} catch {{ Start-Sleep -Milliseconds (250 * $a) }}
        }}
    }}
}}

foreach ($d in @('dist-pkg', 'resources\app', 'frontend\dist')) {{
    $srcD = Join-Path $BackupDir $d
    $dstD = Join-Path $InstallDir $d
    if (Test-Path -LiteralPath $srcD) {{
        if (-not (Test-Path -LiteralPath $dstD)) {{ New-Item -ItemType Directory -Path $dstD -Force | Out-Null }}
        Copy-Item -Path (Join-Path $srcD '*') -Destination $dstD -Recurse -Force -ErrorAction SilentlyContinue
    }}
}}

Start-Sleep -Milliseconds 500
$vbs = Join-Path $InstallDir 'RUN-PharmacyOS-Silent.vbs'
$exe = Join-Path $InstallDir 'PharmacyOS.exe'
if (Test-Path -LiteralPath $vbs) {{
    Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`"" -WorkingDirectory $InstallDir
}} elseif (Test-Path -LiteralPath $exe) {{
    Start-Process -FilePath $exe -WorkingDirectory $InstallDir
}}
"#
    );

    if fs::write(&script_path, ps_script).is_err() {
        return false;
    }

    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
    ])
    .arg(&script_path)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.spawn().is_ok()
}

fn kill_backend(backend_pid: &Arc<Mutex<Option<u32>>>) {
    let pid_opt = backend_pid.lock().ok().and_then(|mut g| g.take());
    if let Some(pid) = pid_opt {
        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }
}

fn main() {
    // Enforce No-GPU rendering contract for WebView2 on CPU-only shop PCs
    if env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu --disable-gpu-compositing --disable-gpu-rasterization --use-gl=swiftshader",
        );
    }

    let backend_pid: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
    let backend_pid_setup = Arc::clone(&backend_pid);
    let backend_pid_exit = Arc::clone(&backend_pid);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .setup(move |app| {
            let win = app
                .get_webview_window("main")
                .ok_or("main window missing")?;

            if env::var("APP_WINDOW_MODE").ok().as_deref() == Some("maximized") {
                let _ = win.set_fullscreen(false);
                let _ = win.maximize();
            }

            let port = get_port();
            let exe_dir = env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

            let app_handle = app.handle().clone();
            thread::spawn(move || {
                let mut backend_ok = check_backend_alive(port, 400);
                if !backend_ok {
                    reclaim_port(port);
                    clean_all_session_locks(&exe_dir);
                    let mut child_opt = spawn_backend(&exe_dir, port);
                    if let Some(ref child) = child_opt {
                        if let Ok(mut guard) = backend_pid_setup.lock() {
                            *guard = Some(child.id());
                        }
                    }

                    let mut fail_reason = "POST_UPDATE_BACKEND_TIMEOUT";
                    let deadline = Instant::now() + Duration::from_secs(60);
                    while Instant::now() < deadline {
                        if check_backend_alive(port, 300) {
                            backend_ok = true;
                            break;
                        }
                        if let Some(ref mut child) = child_opt {
                            if let Ok(Some(_status)) = child.try_wait() {
                                fail_reason = "POST_UPDATE_BACKEND_EXITED";
                                break;
                            }
                        }
                        thread::sleep(Duration::from_millis(50));
                    }

                    if !backend_ok && trigger_post_update_rollback(&exe_dir, fail_reason) {
                        kill_backend(&backend_pid_setup);
                        app_handle.exit(1);
                        return;
                    }
                }

                if let Some(w) = app_handle.get_webview_window("main") {
                    if let Ok(url) = Url::parse(&format!("http://127.0.0.1:{port}")) {
                        let _ = w.navigate(url);
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build AI Pharmacy OS Tauri application");

    app.run(move |_app_handle, event| {
        if let RunEvent::Exit = event {
            kill_backend(&backend_pid_exit);
        }
    });
}
