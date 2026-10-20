//! Git actions on the repository enclosing a vault: switching and creating branches, commit, pull,
//! push, a one-click sync, and settling a pull's conflicts by keeping one side. Runs the `git` CLI,
//! like gitrepo.rs, so the user's own config, credential helper and hooks apply.

use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Mutex, MutexGuard};

/// One git action at a time: two at once would fight over the index lock.
static BUSY: Mutex<()> = Mutex::new(());

pub fn lock() -> MutexGuard<'static, ()> {
    BUSY.lock().unwrap_or_else(|e| e.into_inner())
}

const HISTORY: &str = ".astali/history.jsonl";

fn exec<S: AsRef<OsStr>>(dir: &Path, args: &[S]) -> Result<Output, String> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        // Nobody sees a console, so git must never wait for a username typed in one. Credential
        // helpers with their own window (Git Credential Manager) still work.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_MERGE_AUTOEDIT", "no");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Git is not installed, or not on the PATH".to_string()
        } else {
            e.to_string()
        }
    })
}

/// What git said when it failed, without its "hint:" lines.
fn failure(out: &Output) -> String {
    let text = |b: &[u8]| {
        String::from_utf8_lossy(b)
            .lines()
            .filter(|l| !l.starts_with("hint:") && !l.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    };
    let msg = text(&out.stderr);
    let msg = if msg.is_empty() { text(&out.stdout) } else { msg };
    if msg.is_empty() {
        format!("git failed ({})", out.status)
    } else {
        msg
    }
}

/// Runs git in `dir`; its stdout, or what it printed when it failed.
fn run<S: AsRef<OsStr>>(dir: &Path, args: &[S]) -> Result<String, String> {
    let out = exec(dir, args)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(failure(&out))
    }
}

/// Whether git exits 0, for commands that answer yes/no with their exit code.
fn check<S: AsRef<OsStr>>(dir: &Path, args: &[S]) -> Result<bool, String> {
    Ok(exec(dir, args)?.status.success())
}

fn top_level(vault: &Path) -> Result<PathBuf, String> {
    Ok(PathBuf::from(run(vault, &["rev-parse", "--show-toplevel"])?.trim()))
}

fn upstream(vault: &Path) -> Option<String> {
    run(vault, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .ok()
        .map(|s| s.trim().to_string())
}

// ---------------------------------------------------------------- branches

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branches {
    pub local: Vec<String>,
    /// Remote branches without a local branch of the same name, e.g. "origin/feature".
    pub remote: Vec<String>,
}

fn parse_branches(refs: &str) -> Branches {
    let mut b = Branches::default();
    let mut remote = vec![];
    for line in refs.lines() {
        if let Some(name) = line.strip_prefix("refs/heads/") {
            b.local.push(name.to_string());
        } else if let Some(name) = line.strip_prefix("refs/remotes/") {
            if !name.ends_with("/HEAD") {
                remote.push(name.to_string());
            }
        }
    }
    b.remote = remote
        .into_iter()
        .filter(|r| r.split_once('/').is_none_or(|(_, n)| !b.local.iter().any(|l| l == n)))
        .collect();
    b
}

pub fn branches(vault: &Path) -> Result<Branches, String> {
    let refs = run(
        vault,
        &["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
    )?;
    Ok(parse_branches(&refs))
}

/// Switches to a local branch, or to a new local branch tracking `branch` when `remote` is set.
pub fn checkout(vault: &Path, branch: &str, remote: bool) -> Result<(), String> {
    if branch.is_empty() || branch.starts_with('-') {
        return Err("Pick a branch".into());
    }
    if remote {
        run(vault, &["switch", "--track", branch])?;
    } else {
        run(vault, &["switch", branch])?;
    }
    Ok(())
}

/// Creates a branch from the current commit and switches to it; uncommitted changes come along.
pub fn create_branch(vault: &Path, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || !check(vault, &["check-ref-format", "--branch", name])? {
        return Err(format!("“{name}” can't be a branch name"));
    }
    run(vault, &["switch", "-c", name])?;
    Ok(())
}

// ---------------------------------------------------------------- commit

/// Pathspecs (relative to the vault) of Astali's files: the ones on disk, plus project folders
/// deleted since the last commit, which only the index still knows about.
fn vault_pathspecs(vault: &Path) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = crate::gitignore::vault_entries(vault)
        .into_iter()
        .filter(|(n, _)| vault.join(n).exists())
        .map(|(n, _)| n)
        .collect();
    for file in run(vault, &["ls-files", "-z"])?.split('\0') {
        if let Some(dir) = file.strip_suffix("/project.json") {
            if !dir.contains('/') && !dir.starts_with('.') && !names.iter().any(|n| n == dir) {
                names.push(dir.to_string());
            }
        }
    }
    Ok(names.into_iter().map(|n| format!(":(literal){n}")).collect())
}

/// Commits the vault's files, or every change in the repository with `all`. Other staged changes
/// stay staged in a vault-only commit. `Ok(false)` when there was nothing to commit.
pub fn commit(vault: &Path, message: &str, all: bool) -> Result<bool, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("Write a commit message".into());
    }
    let paths = if all {
        vec![":/".to_string()]
    } else {
        vault_pathspecs(vault)?
    };
    let with = |head: &[&str]| -> Vec<String> {
        head.iter()
            .map(|s| s.to_string())
            .chain(["--".to_string()])
            .chain(paths.iter().cloned())
            .collect()
    };

    run(vault, &with(&["add", "-A"]))?;
    let has_head = check(vault, &["rev-parse", "-q", "--verify", "HEAD"])?;
    // Before the first commit there is nothing to compare with: anything in the index counts.
    let staged = if has_head {
        !check(vault, &with(&["diff", "--cached", "--quiet"]))?
    } else {
        !run(vault, &with(&["ls-files"]))?.trim().is_empty()
    };
    if !staged {
        return Ok(false);
    }
    if all {
        run(vault, &["commit", "-m", message])?;
    } else {
        // Naming the paths commits just them, whatever else is staged.
        run(vault, &with(&["commit", "-m", message]))?;
    }
    Ok(true)
}

// ---------------------------------------------------------------- pull, push, conflicts

/// Files with unresolved conflicts, relative to the repository root.
pub fn conflicts(vault: &Path) -> Result<Vec<String>, String> {
    let root = top_level(vault)?;
    Ok(run(&root, &["diff", "--name-only", "--diff-filter=U", "-z"])?
        .split('\0')
        .filter(|f| !f.is_empty())
        .map(str::to_string)
        .collect())
}

fn is_history(file: &str) -> bool {
    file == HISTORY || file.ends_with(&format!("/{HISTORY}"))
}

/// Keeps both sides of the change history: it only ever grows, so every line of either side is
/// a real change. The merged lines are put back in time order.
fn union_history(root: &Path, file: &str) -> Result<(), String> {
    // Plain conflict markers, whatever conflict style the user configured.
    run(root, &["checkout", "--conflict=merge", "--", file])?;
    let path = root.join(file);
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut lines: Vec<&str> = text
        .lines()
        .filter(|l| !(l.starts_with("<<<<<<< ") || l.starts_with(">>>>>>> ") || *l == "======="))
        .filter(|l| !l.trim().is_empty())
        .collect();
    let time = |l: &str| {
        serde_json::from_str::<serde_json::Value>(l)
            .ok()
            .and_then(|v| v["t"].as_f64())
            .unwrap_or(0.0)
    };
    lines.sort_by(|a, b| time(a).total_cmp(&time(b)));
    lines.dedup();
    crate::vaultfs::write_atomic(&path, &(lines.join("\n") + "\n"))?;
    run(root, &["add", "--", file])?;
    Ok(())
}

fn merging(root: &Path) -> Result<bool, String> {
    check(root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"])
}

/// Pulls with a merge. Conflicts in the change history alone are settled on the spot; otherwise
/// the conflicted files are returned and the merge is left for `resolve` or `abort_merge`.
pub fn pull(vault: &Path) -> Result<Vec<String>, String> {
    // --no-rebase and --ff override pull.rebase and pull.ff=only: conflicts are always a merge's.
    let err = match run(vault, &["pull", "--no-rebase", "--ff", "--no-edit"]) {
        Ok(_) => return Ok(vec![]),
        Err(e) => e,
    };
    let files = conflicts(vault)?;
    if files.is_empty() {
        return Err(err);
    }
    if files.iter().all(|f| is_history(f)) {
        let root = top_level(vault)?;
        for f in &files {
            union_history(&root, f)?;
        }
        run(&root, &["commit", "--no-edit"])?;
        return Ok(vec![]);
    }
    Ok(files)
}

/// Pushes the current branch; one without an upstream is published to `origin` (else the only
/// remote) and tracks it from then on. `Ok(false)` when the repository has no remote.
pub fn push(vault: &Path) -> Result<bool, String> {
    if upstream(vault).is_some() {
        run(vault, &["push"])?;
        return Ok(true);
    }
    let remotes = run(vault, &["remote"])?;
    let remotes: Vec<&str> = remotes.lines().map(str::trim).filter(|r| !r.is_empty()).collect();
    let Some(remote) = remotes.iter().find(|r| **r == "origin").or(remotes.first()) else {
        return Ok(false);
    };
    run(vault, &["push", "-u", remote, "HEAD"])?;
    Ok(true)
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Keep {
    /// The version that came with the pull ("theirs").
    Incoming,
    /// The version that was here before it ("ours").
    Local,
}

/// Settles every conflict of an unfinished merge by keeping one side's version of each file
/// (a file that side deleted is deleted), then concludes the merge. The change history keeps both.
pub fn resolve(vault: &Path, keep: Keep) -> Result<(), String> {
    let root = top_level(vault)?;
    if !merging(&root)? {
        return Err("Astali can only settle the conflicts of a pull. Finish this one in your git tool.".into());
    }
    let side = match keep {
        Keep::Incoming => "--theirs",
        Keep::Local => "--ours",
    };
    for f in conflicts(vault)? {
        if is_history(&f) {
            union_history(&root, &f)?;
        } else if check(&root, &["checkout", side, "--", &f])? {
            run(&root, &["add", "--", &f])?;
        } else {
            // That side has no version of the file: it deleted it.
            run(&root, &["rm", "--quiet", "--", &f])?;
        }
    }
    run(&root, &["commit", "--no-edit"])?;
    Ok(())
}

/// Gives up on the unfinished merge, back to how things were before the pull.
pub fn abort_merge(vault: &Path) -> Result<(), String> {
    run(vault, &["merge", "--abort"])?;
    Ok(())
}

// ---------------------------------------------------------------- sync

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub committed: bool,
    pub pulled: bool,
    pub pushed: bool,
    /// Set when the pull stopped on conflicts; nothing was pushed then.
    pub conflicts: Vec<String>,
}

/// Commits the vault's files, pulls and pushes. Without an upstream there is nothing to pull,
/// and the push publishes the branch; without a remote, it only commits.
pub fn sync(vault: &Path, message: &str) -> Result<SyncResult, String> {
    let mut r = SyncResult {
        committed: commit(vault, message, false)?,
        ..Default::default()
    };
    if upstream(vault).is_some() {
        r.conflicts = pull(vault)?;
        r.pulled = true;
        if !r.conflicts.is_empty() {
            return Ok(r);
        }
    }
    r.pushed = push(vault)?;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_branches_without_remote_duplicates() {
        let refs = "\
refs/heads/main
refs/heads/release/1.9.0
refs/remotes/origin/HEAD
refs/remotes/origin/main
refs/remotes/origin/release/1.8.0
refs/remotes/origin/release/1.9.0
refs/remotes/fork/topic
";
        assert_eq!(
            parse_branches(refs),
            Branches {
                local: vec!["main".into(), "release/1.9.0".into()],
                remote: vec!["origin/release/1.8.0".into(), "fork/topic".into()],
            }
        );
    }

    #[test]
    fn recognizes_history_files() {
        assert!(is_history(".astali/history.jsonl"));
        assert!(is_history("vaults/app/.astali/history.jsonl"));
        assert!(!is_history("vaults/app/.astali/vault.json"));
        assert!(!is_history("x.astali/history.jsonl"));
    }

    // ---- against real repositories (skipped when git isn't installed)

    fn git_ok() -> bool {
        Command::new("git").arg("--version").output().is_ok()
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("astali-gitops-{name}-{}", crate::vaultfs::new_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn g(dir: &Path, args: &[&str]) -> String {
        run(dir, args).unwrap_or_else(|e| panic!("git {args:?}: {e}"))
    }

    fn repo(dir: &Path) {
        g(dir, &["init", "-q", "-b", "main"]);
        g(dir, &["config", "user.name", "Test"]);
        g(dir, &["config", "user.email", "test@example.com"]);
        g(dir, &["config", "commit.gpgsign", "false"]);
    }

    /// A file's text with LF line endings, whatever core.autocrlf did to it.
    fn read(path: impl AsRef<Path>) -> std::io::Result<String> {
        Ok(fs::read_to_string(path)?.replace("\r\n", "\n"))
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    /// A repo with code at the root and a vault in `kb/`, holding one project.
    fn vault_repo(dir: &Path) -> PathBuf {
        repo(dir);
        write(&dir.join("src/main.rs"), "fn main() {}\n");
        let vault = dir.join("kb");
        write(&vault.join(".astali/vault.json"), "{}\n");
        write(&vault.join(".astali/history.jsonl"), "{\"t\":1}\n");
        write(&vault.join("proj/project.json"), "{}\n");
        g(dir, &["add", "-A"]);
        g(dir, &["commit", "-q", "-m", "init"]);
        vault
    }

    #[test]
    fn vault_commit_leaves_other_changes_alone() {
        if !git_ok() {
            return;
        }
        let dir = tmp("commit");
        let vault = vault_repo(&dir);
        assert!(!commit(&vault, "nothing", false).unwrap());

        write(&dir.join("src/main.rs"), "fn main() { todo!() }\n");
        g(&dir, &["add", "src/main.rs"]);
        write(&vault.join("proj/boards/b.json"), "{}\n");
        assert!(commit(&vault, "Boards", false).unwrap());
        let files = g(&dir, &["show", "--name-only", "--format=", "HEAD"]);
        assert_eq!(files.trim(), "kb/proj/boards/b.json");
        // The staged code change is still staged, not committed.
        assert_eq!(g(&dir, &["diff", "--cached", "--name-only"]).trim(), "src/main.rs");

        // A deleted project is committed as deleted.
        fs::remove_dir_all(vault.join("proj")).unwrap();
        assert!(commit(&vault, "Drop project", false).unwrap());
        assert!(g(&dir, &["ls-files", "kb/proj"]).trim().is_empty());

        assert!(commit(&vault, "Everything", true).unwrap());
        assert!(g(&dir, &["status", "--porcelain"]).trim().is_empty());
        assert!(commit(&vault, "  ", true).is_err());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn branches_create_and_switch() {
        if !git_ok() {
            return;
        }
        let dir = tmp("branch");
        let vault = vault_repo(&dir);
        assert!(create_branch(&vault, "bad name..").is_err());
        create_branch(&vault, "feature/x").unwrap();
        assert_eq!(branches(&vault).unwrap().local, vec!["feature/x", "main"]);
        checkout(&vault, "main", false).unwrap();
        assert_eq!(g(&dir, &["branch", "--show-current"]).trim(), "main");
        fs::remove_dir_all(dir).ok();
    }

    /// An origin with two clones of it, both on main and tracking it.
    fn clones(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let base = tmp(name);
        let origin = base.join("origin.git");
        fs::create_dir_all(&origin).unwrap();
        g(&origin, &["init", "-q", "--bare", "-b", "main"]);
        let a = base.join("a");
        fs::create_dir_all(&a).unwrap();
        let vault = vault_repo(&a);
        g(&a, &["remote", "add", "origin", origin.to_str().unwrap()]);
        assert!(push(&vault).unwrap());
        let b = base.join("b");
        g(&base, &["clone", "-q", origin.to_str().unwrap(), b.to_str().unwrap()]);
        repo_identity(&b);
        (base, vault, b.join("kb"))
    }

    fn repo_identity(dir: &Path) {
        g(dir, &["config", "user.name", "Test"]);
        g(dir, &["config", "user.email", "test@example.com"]);
        g(dir, &["config", "commit.gpgsign", "false"]);
    }

    #[test]
    fn sync_merges_history_and_settles_conflicts() {
        if !git_ok() {
            return;
        }
        let (base, a, b) = clones("sync");
        // Both sides add history and edit the same board.
        write(&a.join(".astali/history.jsonl"), "{\"t\":1}\n{\"t\":2}\n");
        write(&a.join("proj/project.json"), "{\"name\":\"A\"}\n");
        let r = sync(&a, "From A").unwrap();
        assert!(r.committed && r.pulled && r.pushed && r.conflicts.is_empty());

        write(&b.join(".astali/history.jsonl"), "{\"t\":1}\n{\"t\":3}\n");
        write(&b.join("proj/project.json"), "{\"name\":\"B\"}\n");
        let r = sync(&b, "From B").unwrap();
        assert!(r.committed && !r.pushed);
        assert_eq!(r.conflicts, vec!["kb/.astali/history.jsonl", "kb/proj/project.json"]);

        resolve(&b, Keep::Incoming).unwrap();
        assert_eq!(read(b.join("proj/project.json")).unwrap(), "{\"name\":\"A\"}\n");
        assert_eq!(
            read(b.join(".astali/history.jsonl")).unwrap(),
            "{\"t\":1}\n{\"t\":2}\n{\"t\":3}\n"
        );
        assert!(conflicts(&b).unwrap().is_empty());
        assert!(push(&b).unwrap());

        // Only the history in conflict: the pull settles it by itself.
        write(
            &a.join(".astali/history.jsonl"),
            "{\"t\":1}\n{\"t\":2}\n{\"t\":3}\n{\"t\":4}\n",
        );
        assert!(sync(&a, "A again").unwrap().conflicts.is_empty());
        let lines = read(a.join(".astali/history.jsonl")).unwrap();
        assert_eq!(lines, "{\"t\":1}\n{\"t\":2}\n{\"t\":3}\n{\"t\":4}\n");
        fs::remove_dir_all(base).ok();
    }

    #[test]
    fn keeping_local_and_aborting() {
        if !git_ok() {
            return;
        }
        let (base, a, b) = clones("keep");
        write(&a.join("proj/project.json"), "{\"name\":\"A\"}\n");
        sync(&a, "From A").unwrap();
        write(&b.join("proj/project.json"), "{\"name\":\"B\"}\n");
        assert_eq!(sync(&b, "From B").unwrap().conflicts.len(), 1);
        abort_merge(&b).unwrap();
        assert!(conflicts(&b).unwrap().is_empty());
        assert_eq!(pull(&b).unwrap().len(), 1);
        resolve(&b, Keep::Local).unwrap();
        assert_eq!(read(b.join("proj/project.json")).unwrap(), "{\"name\":\"B\"}\n");
        assert!(resolve(&b, Keep::Local).is_err()); // no merge going on any more
        fs::remove_dir_all(base).ok();
    }
}
