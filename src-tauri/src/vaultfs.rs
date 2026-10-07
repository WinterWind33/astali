//! Shared filesystem helpers for the app commands and the MCP server.

use serde_json::Value;
use std::collections::hash_map::RandomState;
use std::fs;
use std::hash::{BuildHasher, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const APP_IDENTIFIER: &str = "com.astali.kanban";

/// Writes a file atomically (temp file + rename), creating parent folders.
pub fn write_atomic(target: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension("tmp~");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, target).map_err(|e| e.to_string())
}

pub fn read_json(path: &Path) -> Result<Value, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// Same format as the app writes: 2-space indent and a trailing newline.
pub fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    let mut s = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    s.push('\n');
    write_atomic(path, &s)
}

pub fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut h = RandomState::new().build_hasher();
    h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    h.write_u128(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
    );
    let mut n = h.finish();
    (0..10)
        .map(|_| {
            let c = ALPHABET[(n % 36) as usize] as char;
            n /= 36;
            c
        })
        .collect()
}

/// Current UTC time as ISO-8601 with milliseconds, like JavaScript's `toISOString()`.
pub fn now_iso() -> String {
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = d.as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // Howard Hinnant's civil-from-days algorithm.
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        d.subsec_millis()
    )
}

pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(48).collect();
    if out.is_empty() {
        "untitled".into()
    } else {
        out
    }
}

/// Mirrors Tauri's `app_config_dir()` so the CLI can find the desktop app's settings.
pub fn config_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    base.map(|b| b.join(APP_IDENTIFIER))
}

fn app_config() -> Option<Value> {
    read_json(&config_dir()?.join("config.json")).ok()
}

pub fn last_vault_from_config() -> Option<PathBuf> {
    app_config()?.get("lastVault")?.as_str().map(PathBuf::from)
}

/// The token for GitHub requests: `GITHUB_TOKEN`, else the one saved in the app (OS credential store),
/// else one still in `config.json` (saved before 1.7.0, or where no credential store is available).
pub fn github_token_from_config() -> Option<String> {
    std::env::var("GITHUB_TOKEN")
        .ok()
        .filter(|t| !t.trim().is_empty())
        .or_else(|| crate::secrets::github_token().ok().flatten())
        .or_else(|| app_config()?.get("githubToken")?.as_str().map(String::from))
        .filter(|t| !t.trim().is_empty())
}

/// Every vault has this file; it tells a vault apart from any other folder.
pub fn is_vault(dir: &Path) -> bool {
    dir.join(".astali").join("vault.json").is_file()
}

/// The vault that belongs to `start`, a folder an agent runs in: `start` itself or a folder
/// directly inside it, then the same for each parent up to the repository root (never above it,
/// and not at all outside a repository). The nearest wins; side by side, the first by name.
pub fn find_vault_near(start: &Path) -> Option<PathBuf> {
    let root = crate::gitignore::find_repo_root(start);
    for dir in start.ancestors() {
        if is_vault(dir) {
            return Some(dir.to_path_buf());
        }
        let mut inside: Vec<PathBuf> = fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir() && is_vault(p))
            .collect();
        inside.sort();
        if let Some(v) = inside.into_iter().next() {
            return Some(v);
        }
        if root.as_deref().is_none_or(|r| r == dir) {
            break;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("astali-vaultfs-{name}-{}", new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn make_vault(dir: &Path) {
        fs::create_dir_all(dir.join(".astali")).unwrap();
        fs::write(dir.join(".astali/vault.json"), "{}").unwrap();
    }

    #[test]
    fn finds_the_vault_inside_the_repository() {
        let repo = tmp("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join("src/deep")).unwrap();
        make_vault(&repo.join("kb"));
        assert_eq!(find_vault_near(&repo), Some(repo.join("kb")));
        assert_eq!(find_vault_near(&repo.join("src/deep")), Some(repo.join("kb")));
        assert_eq!(find_vault_near(&repo.join("kb")), Some(repo.join("kb")));
        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn stops_at_the_repository_root() {
        let outer = tmp("outer");
        make_vault(&outer.join("vault"));
        let repo = outer.join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        assert_eq!(find_vault_near(&repo), None);
        let _ = fs::remove_dir_all(&outer);
    }
}
