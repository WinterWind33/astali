//! Detects when a vault lives inside a git repository and maintains a managed block in the
//! repository's root `.gitignore` that lists Astali's files, so they are not committed with
//! the surrounding code. Once the block exists, it is kept in sync as projects come and go.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const BEGIN: &str = "# >>> Astali kanban (managed by the Astali app; edits inside this block are overwritten) >>>";
const END: &str = "# <<< Astali kanban <<<";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// Repository root (the folder containing `.git`).
    pub repo_root: String,
    pub gitignore_path: String,
    /// Vault path relative to the repository root ("" when the vault is the root).
    pub vault_rel: String,
    /// True when the managed block is present in `.gitignore`.
    pub enabled: bool,
    /// Lines the managed block contains (or would contain).
    pub entries: Vec<String>,
}

/// Walks up from `start` looking for `.git` (a folder, or a file for worktrees/submodules).
pub fn find_repo_root(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|p| p.join(".git").exists())
        .map(Path::to_path_buf)
}

fn escape(name: &str) -> String {
    let mut out = String::new();
    for (i, c) in name.chars().enumerate() {
        if matches!(c, '*' | '?' | '[' | ']' | '\\') || (i == 0 && matches!(c, '#' | '!')) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn desired_entries(vault: &Path, rel: &str) -> Vec<String> {
    let prefix = if rel.is_empty() {
        "/".to_string()
    } else {
        format!("/{}/", rel.split('/').map(escape).collect::<Vec<_>>().join("/"))
    };
    let mut out = vec![format!("{prefix}.astali/")];
    // Only our own guide; a repository's existing AGENTS.md is left alone.
    if fs::read_to_string(vault.join("AGENTS.md"))
        .map(|s| s.starts_with("# Astali vault"))
        .unwrap_or(false)
    {
        out.push(format!("{prefix}AGENTS.md"));
    }
    let mut projects: Vec<String> = fs::read_dir(vault)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir() && e.path().join("project.json").is_file())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !n.starts_with('.'))
        .collect();
    projects.sort();
    out.extend(projects.iter().map(|p| format!("{prefix}{}/", escape(p))));
    out
}

fn rel_path(vault: &Path, root: &Path) -> String {
    vault
        .strip_prefix(root)
        .map(|r| {
            r.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// Splits `.gitignore` content into (text without our block, whether the block was present).
fn strip_block(content: &str) -> (String, bool) {
    let mut out = vec![];
    let mut inside = false;
    let mut found = false;
    for line in content.lines() {
        let t = line.trim_end();
        if t == BEGIN {
            inside = true;
            found = true;
            continue;
        }
        if inside {
            if t == END {
                inside = false;
            }
            continue;
        }
        out.push(line);
    }
    // Drop trailing blank lines left behind by the removed block.
    while out.last().is_some_and(|l| l.trim().is_empty()) {
        out.pop();
    }
    (out.join("\n"), found)
}

pub fn status(vault: &Path) -> Option<GitStatus> {
    let root = find_repo_root(vault)?;
    let gitignore = root.join(".gitignore");
    let rel = rel_path(vault, &root);
    let enabled = fs::read_to_string(&gitignore)
        .map(|c| strip_block(&c).1)
        .unwrap_or(false);
    Some(GitStatus {
        // Forward slashes for display, matching how the app shows vault paths.
        repo_root: root.to_string_lossy().replace('\\', "/"),
        gitignore_path: gitignore.to_string_lossy().replace('\\', "/"),
        entries: desired_entries(vault, &rel),
        vault_rel: rel,
        enabled,
    })
}

fn write_if_changed(path: &Path, old: &str, new: &str) -> Result<(), String> {
    if old != new {
        crate::vaultfs::write_atomic(path, new)?;
    }
    Ok(())
}

/// Adds (or refreshes) the managed block. Keeps the file's existing line endings.
pub fn enable(vault: &Path) -> Result<GitStatus, String> {
    let st = status(vault).ok_or("The vault is not inside a git repository")?;
    let path = PathBuf::from(&st.gitignore_path);
    let old = fs::read_to_string(&path).unwrap_or_default();
    let nl = if old.contains("\r\n") { "\r\n" } else { "\n" };
    let (rest, _) = strip_block(&old.replace("\r\n", "\n"));
    let mut lines: Vec<String> = vec![];
    if !rest.is_empty() {
        lines.push(rest);
        lines.push(String::new());
    }
    lines.push(BEGIN.into());
    lines.extend(st.entries.iter().cloned());
    lines.push(END.into());
    let new = lines.join("\n").replace('\n', nl) + nl;
    write_if_changed(&path, &old, &new)?;
    Ok(GitStatus { enabled: true, ..st })
}

/// Removes the managed block, leaving the rest of `.gitignore` untouched.
pub fn disable(vault: &Path) -> Result<GitStatus, String> {
    let st = status(vault).ok_or("The vault is not inside a git repository")?;
    let path = PathBuf::from(&st.gitignore_path);
    let old = fs::read_to_string(&path).unwrap_or_default();
    let nl = if old.contains("\r\n") { "\r\n" } else { "\n" };
    let (rest, found) = strip_block(&old.replace("\r\n", "\n"));
    if found {
        let new = if rest.is_empty() {
            String::new()
        } else {
            rest.replace('\n', nl) + nl
        };
        write_if_changed(&path, &old, &new)?;
    }
    Ok(GitStatus { enabled: false, ..st })
}

/// Refreshes the block after projects were added or removed — only if the user opted in.
pub fn sync_if_enabled(vault: &Path) -> Option<GitStatus> {
    let st = status(vault)?;
    if st.enabled {
        enable(vault).ok()
    } else {
        Some(st)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("astali-gi-{name}-{}", crate::vaultfs::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn detects_repo_and_manages_block() {
        let repo = tmp("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join(".gitignore"), "node_modules\r\ndist\r\n").unwrap();
        let vault = repo.join("docs").join("kanban");
        fs::create_dir_all(vault.join("my-proj")).unwrap();
        fs::write(vault.join("my-proj/project.json"), "{}").unwrap();
        fs::write(vault.join("AGENTS.md"), "# Astali vault\n").unwrap();

        let st = status(&vault).unwrap();
        assert!(!st.enabled);
        assert_eq!(st.vault_rel, "docs/kanban");
        assert_eq!(
            st.entries,
            vec![
                "/docs/kanban/.astali/",
                "/docs/kanban/AGENTS.md",
                "/docs/kanban/my-proj/"
            ]
        );

        enable(&vault).unwrap();
        let text = fs::read_to_string(repo.join(".gitignore")).unwrap();
        assert!(text.starts_with("node_modules\r\ndist\r\n\r\n# >>> Astali"));
        assert!(text.contains("/docs/kanban/my-proj/\r\n# <<< Astali kanban <<<\r\n"));

        // New project is picked up; enabling twice does not duplicate the block.
        fs::create_dir_all(vault.join("other")).unwrap();
        fs::write(vault.join("other/project.json"), "{}").unwrap();
        sync_if_enabled(&vault).unwrap();
        let text = fs::read_to_string(repo.join(".gitignore")).unwrap();
        assert_eq!(text.matches(BEGIN).count(), 1);
        assert!(text.contains("/docs/kanban/other/"));

        disable(&vault).unwrap();
        assert_eq!(
            fs::read_to_string(repo.join(".gitignore")).unwrap(),
            "node_modules\r\ndist\r\n"
        );
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn vault_at_repo_root_and_no_repo() {
        let repo = tmp("root");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join("AGENTS.md"), "# My code agents\n").unwrap();
        let st = enable(&repo).unwrap();
        assert_eq!(st.entries, vec!["/.astali/"]); // foreign AGENTS.md is not ignored
        assert!(fs::read_to_string(repo.join(".gitignore")).unwrap().starts_with(BEGIN));
        fs::remove_dir_all(&repo).ok();

        let plain = tmp("plain");
        // The temp dir itself must not be inside a repo for this assertion to be meaningful.
        if find_repo_root(&plain).is_none() {
            assert!(status(&plain).is_none());
        }
        fs::remove_dir_all(plain).ok();
    }
}
