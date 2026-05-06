// SPEC-FIGMA-004 W4 — FrameEditor component (REQ-02, REQ-15).
//
// Inline editor for PM-facing fields. On Save the form returns a freshly
// constructed ManifestEntry with the updated values; the parent is
// responsible for recomputing manifest_entry_hash because that hash is
// canonicalized in @autopus/write-router/idempotency.

"use client";

import { useState } from "react";
import type { ManifestEntry } from "@autopus/write-router/types";

export interface FrameEditorProps {
  entry: ManifestEntry;
  onSave: (updated: ManifestEntry) => void;
  onCancel: () => void;
}

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function listToLines(values: ReadonlyArray<string> | undefined): string {
  return Array.isArray(values) ? values.join("\n") : "";
}

export default function FrameEditor({
  entry,
  onSave,
  onCancel,
}: FrameEditorProps) {
  const [title, setTitle] = useState(entry.title ?? "");
  const [intent, setIntent] = useState(entry.intent ?? "");
  const [userValue, setUserValue] = useState(entry.user_value ?? "");
  const [successCriteria, setSuccessCriteria] = useState(
    entry.success_criteria ?? "",
  );
  const [statesText, setStatesText] = useState(listToLines(entry.states));
  const [edgeCasesText, setEdgeCasesText] = useState(
    listToLines(entry.edge_cases),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (intent.trim().length === 0) {
      setError("intent는 비어 있을 수 없습니다");
      return;
    }
    const updated: ManifestEntry = {
      ...entry,
      title: title.trim(),
      intent: intent.trim(),
      user_value: userValue.trim(),
      success_criteria: successCriteria.trim(),
      states: linesToList(statesText),
      edge_cases: linesToList(edgeCasesText),
    };
    onSave(updated);
  };

  return (
    <form
      className="frame-editor"
      data-screen-id={entry.screen_id}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="frame-editor-field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="frame-editor-field">
        <span>Intent</span>
        <textarea
          rows={2}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          aria-invalid={error ? "true" : "false"}
          required
        />
      </label>

      <label className="frame-editor-field">
        <span>User value</span>
        <textarea
          rows={2}
          value={userValue}
          onChange={(e) => setUserValue(e.target.value)}
        />
      </label>

      <label className="frame-editor-field">
        <span>Success criteria</span>
        <textarea
          rows={2}
          value={successCriteria}
          onChange={(e) => setSuccessCriteria(e.target.value)}
        />
      </label>

      <label className="frame-editor-field">
        <span>States (한 줄 = 한 항목)</span>
        <textarea
          rows={3}
          value={statesText}
          onChange={(e) => setStatesText(e.target.value)}
        />
      </label>

      <label className="frame-editor-field">
        <span>Edge cases (한 줄 = 한 항목)</span>
        <textarea
          rows={3}
          value={edgeCasesText}
          onChange={(e) => setEdgeCasesText(e.target.value)}
        />
      </label>

      {error ? (
        <p className="frame-editor-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="frame-editor-actions">
        <button type="submit" className="frame-editor-save">
          Save
        </button>
        <button
          type="button"
          className="frame-editor-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
