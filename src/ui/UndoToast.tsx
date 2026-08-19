export interface UndoToastProps {
  /** The deleted marker's label at the moment of deletion. */
  label: string;
  /** Present only when an immediate restore was rejected (alias conflict). */
  error: string | null;
  onUndo(): void;
}

/**
 * The deletion undo affordance: a five-second window with one Undo button.
 * No confirmation dialogs on delete by design — the toast is the safety net.
 */
export function UndoToast({ label, error, onUndo }: UndoToastProps) {
  return (
    <div className="player-undo">
      {error === null ? (
        <p>Marker {label} deleted.</p>
      ) : (
        <p>Marker {label} deleted — can't restore: {error}</p>
      )}
      {error === null && (
        <button type="button" onClick={onUndo}>
          Undo
        </button>
      )}
    </div>
  );
}
