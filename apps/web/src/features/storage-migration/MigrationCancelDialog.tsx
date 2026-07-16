import { useEffect, useRef } from "react";

interface MigrationCancelDialogProps {
  open: boolean;
  onContinue: () => void;
  onConfirm: () => void;
}

export function MigrationCancelDialog({ open, onContinue, onConfirm }: MigrationCancelDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="migration-cancel-dialog"
      aria-labelledby="migration-cancel-title"
      onCancel={(event) => {
        event.preventDefault();
        onContinue();
      }}
    >
      <h2 id="migration-cancel-title">安全停止升级？</h2>
      <p>系统会先完成当前正在处理的模块，然后停止，不会启用不完整的新存储。之后可以继续升级或恢复到升级前。</p>
      <div className="migration-cancel-dialog__actions">
        <button className="migration-text-button" type="button" onClick={onContinue}>继续升级</button>
        <button className="primary-button" type="button" onClick={onConfirm}>安全停止</button>
      </div>
    </dialog>
  );
}
