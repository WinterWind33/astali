fn main() {
    // The icons are built into the executable, but tauri-build only watches tauri.conf.json: without
    // this, a new icon shows up only after something else forces a rebuild.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
