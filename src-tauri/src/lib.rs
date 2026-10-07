mod gh;
mod gitignore;
mod gitrepo;
mod history;
pub mod mcp;
mod notes;
mod plan;
mod secrets;
mod vaultfs;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    is_dir: bool,
}

/// Reads a UTF-8 text file. Returns `None` when the file does not exist.
#[tauri::command]
fn read_text(path: String) -> CmdResult<Option<String>> {
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

/// Writes a file; project and board files of the open vault are recorded in its history.
#[tauri::command]
fn write_text(vault: tauri::State<OpenVault>, path: String, contents: String) -> CmdResult<()> {
    let vault = vault.0.lock().unwrap().clone();
    history::write_text(vault.as_deref(), Path::new(&path), &contents, &history::Actor::app())
}

#[tauri::command]
fn list_dir(path: String) -> CmdResult<Vec<DirEntry>> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(p).map_err(err)? {
        let entry = entry.map_err(err)?;
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            is_dir: entry.file_type().map_err(err)?.is_dir(),
        });
    }
    Ok(out)
}

/// Removes a file or folder; deleted boards and projects of the open vault are recorded in its history.
#[tauri::command]
fn remove_path(vault: tauri::State<OpenVault>, path: String) -> CmdResult<()> {
    let vault = vault.0.lock().unwrap().clone();
    history::remove(vault.as_deref(), Path::new(&path), &history::Actor::app())
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

fn config_path(app: &tauri::AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("config.json"))
}

/// App-level settings (recent vaults, theme). Kept outside the vault on purpose, so nothing personal
/// ends up in a synced folder. The GitHub token is in the OS credential store (see secrets.rs).
#[tauri::command]
fn load_app_config(app: tauri::AppHandle) -> CmdResult<Option<String>> {
    read_text(config_path(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn save_app_config(app: tauri::AppHandle, contents: String) -> CmdResult<()> {
    vaultfs::write_atomic(&config_path(&app)?, &contents)
}

/// Renames a settings file that can't be read to `config.unreadable-<time>.json`, so the defaults
/// the app falls back to never overwrite it. Returns the new file name.
#[tauri::command]
fn set_aside_app_config(app: tauri::AppHandle) -> CmdResult<String> {
    let path = config_path(&app)?;
    let name = format!("config.unreadable-{}.json", vaultfs::now_iso().replace([':', '.'], "-"));
    fs::rename(&path, path.with_file_name(&name)).map_err(err)?;
    Ok(name)
}

/// The GitHub token from the OS credential store; an error when the store can't be reached.
#[tauri::command]
fn load_github_token() -> CmdResult<Option<String>> {
    secrets::github_token()
}

/// Saves the GitHub token in the OS credential store, or removes it when blank.
#[tauri::command]
fn save_github_token(token: String) -> CmdResult<()> {
    secrets::set_github_token(&token)
}

/// Absolute path of this executable, so the UI can show how to register the MCP server.
#[tauri::command]
fn exe_path() -> CmdResult<String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(err)
}

/// Whether this copy can update itself. On Linux only the AppImage replaces itself: a .deb or .rpm
/// install is updated by the package manager.
#[tauri::command]
fn updates_supported() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

// ---------------------------------------------------------------- git integration

/// `None` when the vault is not inside a git repository.
#[tauri::command]
fn git_status(vault: String) -> Option<gitignore::GitStatus> {
    gitignore::status(Path::new(&vault))
}

/// Branch and working-tree summary; `None` outside a repository or when git is not installed.
/// Async so the `git` process runs off the main thread.
#[tauri::command]
async fn git_repo_info(vault: String) -> Option<gitrepo::RepoInfo> {
    gitrepo::info(Path::new(&vault))
}

/// Whether GitHub accepts the token and when it expires. Async so the request runs off the main thread.
#[tauri::command]
async fn github_token_status(token: String) -> CmdResult<serde_json::Value> {
    gh::token_status(&token)
}

#[tauri::command]
fn git_ignore_enable(vault: String) -> CmdResult<gitignore::GitStatus> {
    gitignore::enable(Path::new(&vault))
}

#[tauri::command]
fn git_ignore_disable(vault: String) -> CmdResult<gitignore::GitStatus> {
    gitignore::disable(Path::new(&vault))
}

#[tauri::command]
fn git_ignore_sync(vault: String) -> Option<gitignore::GitStatus> {
    gitignore::sync_if_enabled(Path::new(&vault))
}

// ---------------------------------------------------------------- history

/// Recent changes, newest first; see `history::list`.
#[tauri::command]
async fn history_list(
    vault: String,
    project: Option<String>,
    board: Option<String>,
    limit: Option<usize>,
) -> Vec<serde_json::Value> {
    let filter = history::Filter {
        project: project.as_deref(),
        board: board.as_deref(),
        by: None,
        limit: limit.unwrap_or(200),
    };
    history::list(Path::new(&vault), &filter)
}

#[tauri::command]
async fn history_undo(vault: String, id: String, skip_conflicts: bool) -> CmdResult<serde_json::Value> {
    history::undo(Path::new(&vault), &id, skip_conflicts, &history::Actor::app())
}

// ---------------------------------------------------------------- plans

/// Reads a plan drafted in Markdown: `{ title, plan }`; see `plan::from_markdown`.
#[tauri::command]
fn plan_from_markdown(markdown: String) -> serde_json::Value {
    let (title, plan) = plan::from_markdown(&markdown);
    serde_json::json!({ "title": title, "plan": plan })
}

#[tauri::command]
fn plan_to_markdown(name: String, plan: serde_json::Value) -> String {
    plan::to_markdown(&name, &plan)
}

// ---------------------------------------------------------------- vault watcher

/// The vault the window has open (set together with its watcher), so writes to it get recorded.
#[derive(Default)]
struct OpenVault(Mutex<Option<PathBuf>>);

#[derive(Default)]
struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

/// Watches the vault recursively and emits `vault-changed` with the changed paths,
/// batched so that a burst of writes produces a single event.
#[tauri::command]
fn watch_vault(
    app: tauri::AppHandle,
    state: tauri::State<WatchState>,
    open: tauri::State<OpenVault>,
    path: String,
) -> CmdResult<()> {
    *open.0.lock().unwrap() = Some(PathBuf::from(&path));
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(err)?;
    watcher.watch(Path::new(&path), RecursiveMode::Recursive).map_err(err)?;

    std::thread::spawn(move || {
        let mut batch: Vec<String> = vec![];
        loop {
            let msg = if batch.is_empty() {
                rx.recv().map_err(|_| mpsc::RecvTimeoutError::Disconnected)
            } else {
                rx.recv_timeout(Duration::from_millis(150))
            };
            match msg {
                Ok(Ok(ev)) => {
                    if matches!(ev.kind, notify::EventKind::Access(_)) {
                        continue;
                    }
                    for p in ev.paths {
                        let s = p.to_string_lossy().into_owned();
                        if !s.ends_with(".tmp~") && !batch.contains(&s) {
                            batch.push(s);
                        }
                    }
                }
                Ok(Err(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let _ = app.emit("vault-changed", std::mem::take(&mut batch));
                }
                // Sender dropped: the watcher was replaced or removed.
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_vault(state: tauri::State<WatchState>, open: tauri::State<OpenVault>) {
    *state.0.lock().unwrap() = None;
    *open.0.lock().unwrap() = None;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(WatchState::default())
        .manage(OpenVault::default())
        .invoke_handler(tauri::generate_handler![
            read_text,
            write_text,
            list_dir,
            remove_path,
            path_exists,
            load_app_config,
            save_app_config,
            set_aside_app_config,
            load_github_token,
            save_github_token,
            exe_path,
            updates_supported,
            watch_vault,
            unwatch_vault,
            git_status,
            git_repo_info,
            git_ignore_enable,
            git_ignore_disable,
            git_ignore_sync,
            github_token_status,
            history_list,
            history_undo,
            plan_from_markdown,
            plan_to_markdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running Astali");
}
