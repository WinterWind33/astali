//! The app settings an AI agent may read and change through the MCP server. They live in the
//! desktop app's `config.json`, which the app reloads when the file changes; every other key in it
//! (recent vaults, the token's expiry, favorite colors…) is kept as it is.

use serde_json::{json, Map, Value};
use std::path::Path;

pub const THEMES: &[&str] = &["dark", "light", "system"];
/// Most changes automatic sync may wait for; the app's settings field has the same limit.
pub const AUTO_SYNC_MAX: u64 = 1000;

/// A vault path the way the app writes it: forward slashes, no trailing slash.
fn norm(vault: &Path) -> String {
    vault
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

/// The key the app files `vault` under in per-vault settings: the spelling it already uses (in the
/// recent vaults or the settings themselves) when one matches ignoring case, as Windows paths do.
fn vault_key(config: &Value, vault: &Path) -> String {
    let path = norm(vault);
    let known = config["recentVaults"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .chain(
            config["gitAutoSync"]
                .as_object()
                .into_iter()
                .flat_map(|m| m.keys().map(String::as_str)),
        );
    known
        .map(|k| k.trim_end_matches('/'))
        .find(|k| k.eq_ignore_ascii_case(&path))
        .map(str::to_string)
        .unwrap_or(path)
}

/// The settings as an agent sees them. `autoSync` is the session vault's (0 when off).
pub fn view(config: &Value, vault: Option<&Path>) -> Value {
    let auto = vault
        .map(|v| config["gitAutoSync"][vault_key(config, v)].as_u64().unwrap_or(0))
        .unwrap_or(0);
    json!({
        "theme": config["theme"].as_str().filter(|t| THEMES.contains(t)).unwrap_or("dark"),
        "seasonalThemes": config["seasonalThemes"].as_bool().unwrap_or(false),
        "checkForUpdates": config["checkForUpdates"].as_bool().unwrap_or(true),
        "autoSync": auto,
    })
}

/// Applies the settings given in `args` to `config`; the names of those that changed.
pub fn update(config: &mut Value, vault: Option<&Path>, args: &Value) -> Result<Vec<String>, String> {
    if !config.is_object() {
        *config = json!({});
    }
    let before = view(config, vault);
    let obj = config.as_object_mut().unwrap();

    if let Some(t) = args.get("theme") {
        let t = t.as_str().filter(|t| THEMES.contains(t));
        let t = t.ok_or_else(|| format!("theme must be one of {}", THEMES.join(", ")))?;
        obj.insert("theme".into(), json!(t));
    }
    for key in ["seasonalThemes", "checkForUpdates"] {
        if let Some(v) = args.get(key) {
            let v = v.as_bool().ok_or_else(|| format!("{key} must be true or false"))?;
            obj.insert(key.into(), json!(v));
        }
    }
    if let Some(n) = args.get("autoSync") {
        let n = n
            .as_u64()
            .filter(|n| *n <= AUTO_SYNC_MAX)
            .ok_or_else(|| format!("autoSync must be a whole number from 0 (off) to {AUTO_SYNC_MAX}"))?;
        let vault = vault.ok_or("No vault is open, so there is no automatic sync to set")?;
        let key = vault_key(&Value::Object(obj.clone()), vault);
        let per_vault = obj.entry("gitAutoSync").or_insert_with(|| json!({}));
        if !per_vault.is_object() {
            *per_vault = json!({});
        }
        let map: &mut Map<String, Value> = per_vault.as_object_mut().unwrap();
        if n == 0 {
            map.remove(&key);
        } else {
            map.insert(key, json!(n));
        }
    }

    let after = view(config, vault);
    Ok(["theme", "seasonalThemes", "checkForUpdates", "autoSync"]
        .into_iter()
        .filter(|k| before[k] != after[k])
        .map(String::from)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_defaults_and_the_vaults_own_auto_sync() {
        let config = json!({
            "recentVaults": ["D:/Repos/designs/vaults/app"],
            "gitAutoSync": { "D:/Repos/designs/vaults/app": 10, "D:/other": 5 },
        });
        // Matched whatever the case and slashes of the path.
        let vault = Path::new(r"d:\repos\designs\vaults\app\");
        assert_eq!(
            view(&config, Some(vault)),
            json!({ "theme": "dark", "seasonalThemes": false, "checkForUpdates": true, "autoSync": 10 })
        );
        assert_eq!(view(&config, None)["autoSync"], 0);
        assert_eq!(view(&json!({ "theme": "neon" }), None)["theme"], "dark");
    }

    #[test]
    fn changes_only_what_is_given_and_keeps_other_keys() {
        let vault = Path::new("D:/repos/kb");
        let mut config = json!({ "recentVaults": ["D:/Repos/KB"], "lastVault": "D:/Repos/KB", "theme": "light" });
        let changed = update(&mut config, Some(vault), &json!({ "autoSync": 20, "theme": "light" })).unwrap();
        assert_eq!(changed, vec!["autoSync"]);
        // Filed under the app's own spelling of the path.
        assert_eq!(config["gitAutoSync"], json!({ "D:/Repos/KB": 20 }));
        assert_eq!(config["lastVault"], "D:/Repos/KB");

        let changed = update(
            &mut config,
            Some(vault),
            &json!({ "autoSync": 0, "seasonalThemes": true }),
        )
        .unwrap();
        assert_eq!(changed, vec!["seasonalThemes", "autoSync"]);
        assert_eq!(config["gitAutoSync"], json!({}));

        assert!(update(&mut config, Some(vault), &json!({ "theme": "neon" })).is_err());
        assert!(update(&mut config, Some(vault), &json!({ "autoSync": -1 })).is_err());
        assert!(update(&mut config, Some(vault), &json!({ "autoSync": 5000 })).is_err());
        assert!(update(&mut config, None, &json!({ "autoSync": 5 })).is_err());
        assert!(update(&mut config, Some(vault), &json!({ "checkForUpdates": "no" })).is_err());
    }
}
