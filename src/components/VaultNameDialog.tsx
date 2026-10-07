import { useState } from "react";
import { renameVault, toast, useStore } from "../lib/store";
import { folderName, vaultName } from "../lib/vault";
import { Modal, ModalHeader } from "./ui";

/** Names the open vault without touching its folder; an empty name goes back to the folder's. */
export function VaultNameDialog({ onClose }: { onClose: () => void }) {
  const vault = useStore((s) => s.vault);
  const names = useStore((s) => s.config.vaultNames);
  const [name, setName] = useState(() => (vault ? (names[vault] ?? "") : ""));
  const [busy, setBusy] = useState(false);
  if (!vault) return null;
  const unchanged = name.trim() === (names[vault] ?? "");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (unchanged) return onClose();
    setBusy(true);
    try {
      await renameVault(name);
      toast(name.trim() ? `Vault renamed to “${name.trim()}”` : `Vault goes by its folder's name again`, "success");
      onClose();
    } catch (err) {
      toast(`Could not rename the vault: ${err}`, "error");
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={460}>
      <ModalHeader
        title="Rename vault"
        subtitle={`Currently “${vaultName(vault, names)}”. The folder keeps its name.`}
        onClose={onClose}
      />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>
            Name <em className="faint">— stored in the vault, so it follows it to other computers</em>
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={folderName(vault)}
            maxLength={80}
          />
        </label>
        <p className="faint small">Leave it empty to use the folder's name ({folderName(vault)}).</p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={unchanged || busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
