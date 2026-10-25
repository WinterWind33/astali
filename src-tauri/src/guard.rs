//! What the window may touch on disk (D-19). The file commands take paths from the web view, so a
//! script slipped into it (say, through an issue body) must not reach past the open vault: files
//! are read, listed, written and removed only inside it, never inside a `.git` folder, and only
//! the vault's own kinds of files are written. A vault is opened only if it already is one, or if
//! the user just picked its folder in a dialog the backend showed.

use std::path::{Component, Path, PathBuf};

/// A path as compared here: forward slashes, no trailing slash, and lowercase where file names
/// ignore case (Windows, and macOS by default).
fn key(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let s = s.trim_end_matches('/');
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s.to_string()
    }
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    key(a) == key(b)
}

/// `path` when it lies strictly inside `vault`, has no `.`/`..` steps and goes through no git folder.
pub fn inside(vault: &Path, path: &Path) -> Result<PathBuf, String> {
    let refused = || format!("{} is outside the open vault", path.display());
    let rest = key(path)
        .strip_prefix(&(key(vault) + "/"))
        .map(str::to_string)
        .ok_or_else(refused)?;
    if rest.is_empty() {
        return Err(refused());
    }
    for c in Path::new(&rest).components() {
        match c {
            Component::Normal(n) if !n.to_string_lossy().to_lowercase().starts_with(".git") => {}
            _ => return Err(refused()),
        }
    }
    Ok(path.to_path_buf())
}

/// Like [`inside`], for a file the app writes: JSON data or a Markdown guide.
pub fn writable(vault: &Path, path: &Path) -> Result<PathBuf, String> {
    let p = inside(vault, path)?;
    match p.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("json" | "md") => Ok(p),
        _ => Err(format!("Astali doesn't write files like {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_to_the_vault() {
        let v = Path::new("C:/Users/me/kb");
        assert!(inside(v, Path::new("C:/Users/me/kb/proj/project.json")).is_ok());
        assert!(inside(v, Path::new("C:/Users/me/kb/.astali/vault.json")).is_ok());
        assert!(inside(v, Path::new("C:/Users/me/kb")).is_err());
        assert!(inside(v, Path::new("C:/Users/me/kb2/x.json")).is_err());
        assert!(inside(v, Path::new("C:/Users/me/kb/../.ssh/id_rsa")).is_err());
        assert!(inside(v, Path::new("C:/Users/me/kb/./x.json")).is_err());
        assert!(inside(v, Path::new("C:/Users/me/kb/.git/hooks/pre-commit")).is_err());
        assert!(inside(v, Path::new("C:/Users/me/kb/p/.gitattributes")).is_err());
        assert!(inside(v, Path::new("D:/elsewhere/x.json")).is_err());
    }

    #[test]
    fn writes_only_data_and_guides() {
        let v = Path::new("/home/me/kb");
        assert!(writable(v, Path::new("/home/me/kb/AGENTS.md")).is_ok());
        assert!(writable(v, Path::new("/home/me/kb/p/boards/b-1.json")).is_ok());
        assert!(writable(v, Path::new("/home/me/kb/p/run.sh")).is_err());
        assert!(writable(v, Path::new("/home/me/kb/p/noext")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn ignores_case_and_separators_on_windows() {
        let v = Path::new("C:/Users/Me/KB");
        assert!(inside(v, Path::new("c:\\users\\me\\kb\\p\\project.json")).is_ok());
    }
}
