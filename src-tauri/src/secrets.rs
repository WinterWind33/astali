//! The GitHub token, kept in the OS credential store (Windows Credential Manager, macOS Keychain,
//! the Secret Service on Linux) rather than in `config.json`. The app and the MCP server read the
//! same entry.

use crate::vaultfs::APP_IDENTIFIER;

const GITHUB_TOKEN: &str = "github-token";

fn entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(APP_IDENTIFIER, name).map_err(|e| e.to_string())
}

/// The saved token; `Ok(None)` when there is none, `Err` when the credential store can't be reached.
pub fn github_token() -> Result<Option<String>, String> {
    read(GITHUB_TOKEN)
}

/// Saves the token, or removes it when `token` is blank.
pub fn set_github_token(token: &str) -> Result<(), String> {
    write(GITHUB_TOKEN, token)
}

fn read(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(t) => Ok(Some(t).filter(|t| !t.trim().is_empty())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn write(name: &str, token: &str) -> Result<(), String> {
    let e = entry(name)?;
    if token.trim().is_empty() {
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        };
    }
    e.set_password(token.trim()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Uses the real credential store under a throwaway name, never the app's own entry. Skipped where
    /// there is none (a Linux CI machine has no Secret Service): the app falls back to config.json there (D-7).
    #[test]
    fn a_secret_is_saved_read_and_removed() {
        let name = format!("test-{}", crate::vaultfs::new_id());
        if let Err(e) = read(&name) {
            eprintln!("skipped: no credential store on this machine ({e})");
            return;
        }
        assert_eq!(read(&name), Ok(None));
        write(&name, " ghp_example ").unwrap();
        assert_eq!(read(&name), Ok(Some("ghp_example".into())));
        write(&name, "").unwrap();
        assert_eq!(read(&name), Ok(None));
        write(&name, "").unwrap(); // removing what isn't there is fine
    }
}
